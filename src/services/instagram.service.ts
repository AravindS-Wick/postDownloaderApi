/**
 * Instagram service — fetches user posts via Instagram's mobile API.
 *
 * Pagination strategy:
 *   Page 1:  web_profile_info (NO cookies) — returns up to 12 posts
 *            → stores userId + last post's numeric ID as the "cursor"
 *   Page 2+: /api/v1/feed/user/{userId}/?count=12&max_id={lastPostId} (with cookies)
 *            → each page stores its last post ID as the cursor for the next page
 *
 * Key insight: `max_id` in the feed API must be the NUMERIC post ID of the
 * last item from the previous page (NOT the base64 end_cursor from web_profile_info).
 */

import fs from 'fs';
import path from 'path';

interface PostItem {
    id: string;
    title: string;
    thumbnail: string;
    duration: number;
    url: string;
    platform: string;
}

interface ChannelResult {
    posts: PostItem[];
    hasMore: boolean;
    error?: string;
}

// In-memory cache: key = "username:page", value = { data, timestamp }
const cache = new Map<string, { data: ChannelResult; timestamp: number }>();
// Cursor store: key = "username:page" → last post's numeric ID (for next page's max_id)
const cursorStore = new Map<string, string>();
// User ID store: key = username → numeric user ID
const userIdStore = new Map<string, string>();

const CACHE_TTL = 5 * 60 * 1000; // 5 minutes
const MAX_CACHE_SIZE = 50;
let lastRequestTime = 0;
const MIN_REQUEST_GAP = 1500; // 1.5 seconds between requests

// ── Cookie parsing ────────────────────────────────────────────────────────────

function loadInstagramCookiesFromFile(cookiesFile: string): string {
    if (!cookiesFile || !fs.existsSync(cookiesFile)) return '';
    try {
        const lines = fs.readFileSync(cookiesFile, 'utf8').split('\n');
        const igCookies: string[] = [];
        for (const line of lines) {
            if (!line || line.startsWith('#')) continue;
            const parts = line.split('\t');
            if (parts.length < 7) continue;
            const [domain, , , , , name, value] = parts;
            if (domain && (domain.includes('instagram.com') || domain.includes('.instagram.com'))) {
                igCookies.push(`${name}=${value.trim()}`);
            }
        }
        return igCookies.join('; ');
    } catch {
        return '';
    }
}

const COOKIES_FILE = (() => {
    const raw = process.env.COOKIES_FILE || '';
    if (!raw) return '';
    return path.isAbsolute(raw) ? raw : path.resolve(process.cwd(), raw);
})();

function getInstagramCookieHeader(): string {
    return loadInstagramCookiesFromFile(COOKIES_FILE);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function evictExpiredCache() {
    const now = Date.now();
    for (const [key, entry] of cache) {
        if (now - entry.timestamp > CACHE_TTL) cache.delete(key);
    }
    if (cache.size > MAX_CACHE_SIZE) {
        const oldest = [...cache.entries()].sort((a, b) => a[1].timestamp - b[1].timestamp);
        for (let i = 0; i < oldest.length - MAX_CACHE_SIZE; i++) {
            cache.delete(oldest[i][0]);
        }
    }
}

const BASE_HEADERS: Record<string, string> = {
    'User-Agent': 'Instagram 275.0.0.27.98 Android (33/13; 420dpi; 1080x2400; samsung; SM-G991B; o1s; exynos2100)',
    'X-IG-App-ID': '936619743392459',
    'Accept': '*/*',
    'Accept-Language': 'en-US,en;q=0.9',
    'Sec-Fetch-Dest': 'empty',
    'Sec-Fetch-Mode': 'cors',
    'Sec-Fetch-Site': 'same-site',
};

async function igFetch(url: string, cookieHeader?: string, retries = 3): Promise<Response> {
    const now = Date.now();
    const elapsed = now - lastRequestTime;
    if (elapsed < MIN_REQUEST_GAP) {
        await new Promise(r => setTimeout(r, MIN_REQUEST_GAP - elapsed));
    }
    lastRequestTime = Date.now();

    const headers: Record<string, string> = { ...BASE_HEADERS };
    if (cookieHeader) headers['Cookie'] = cookieHeader;

    for (let attempt = 0; attempt <= retries; attempt++) {
        const res = await fetch(url, { headers });
        if (res.status === 429 && attempt < retries) {
            const delay = (attempt + 1) * 4000;
            console.warn(`[Instagram] 429 rate limit — retrying in ${delay / 1000}s`);
            await new Promise(r => setTimeout(r, delay));
            continue;
        }
        return res;
    }
    throw new Error('Instagram request failed after retries');
}

function extractUsername(url: string): string | null {
    const match = url.match(/instagram\.com\/([^/?#]+)/);
    if (!match) return null;
    const name = match[1].toLowerCase();
    if (['p', 'reel', 'tv', 'stories', 'explore', 'accounts', 'direct', 'reels'].includes(name)) return null;
    return name;
}

// ── Main export ───────────────────────────────────────────────────────────────

export async function getInstagramUserPosts(url: string, page: number, pageSize: number): Promise<ChannelResult> {
    const username = extractUsername(url);
    if (!username) {
        return { posts: [], hasMore: false, error: 'Could not extract Instagram username from URL' };
    }

    const cacheKey = `${username}:${page}`;
    const cached = cache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
        console.log(`[Instagram] Cache hit for ${cacheKey}`);
        return cached.data;
    }

    try {
        // ── Page 1: web_profile_info WITHOUT cookies ─────────────────────────
        // Sending cookies here causes Instagram to return 0 posts in edge_owner_to_timeline_media
        if (page === 1) {
            const profileUrl = `https://i.instagram.com/api/v1/users/web_profile_info/?username=${encodeURIComponent(username)}`;
            const res = await igFetch(profileUrl); // No cookies for page 1
            if (!res.ok) {
                const text = await res.text().catch(() => '');
                console.warn(`[Instagram] web_profile_info ${res.status}: ${text.slice(0, 200)}`);
                return { posts: [], hasMore: false, error: `Instagram returned ${res.status}` };
            }
            const data = await res.json();
            const user = data?.data?.user;
            if (!user) {
                return { posts: [], hasMore: false, error: 'Instagram user not found' };
            }

            userIdStore.set(username, user.id);

            const edges = user.edge_owner_to_timeline_media?.edges || [];
            const pageInfo = user.edge_owner_to_timeline_media?.page_info;
            const hasMore = pageInfo?.has_next_page || false;

            const posts = edges.slice(0, pageSize).map((edge: any) => {
                const node = edge.node;
                return {
                    id: node.shortcode || node.id,
                    title: (node.edge_media_to_caption?.edges?.[0]?.node?.text || '').slice(0, 100),
                    thumbnail: node.thumbnail_src || node.display_url || '',
                    duration: node.video_duration || 0,
                    url: `https://www.instagram.com/p/${node.shortcode}/`,
                    platform: 'instagram',
                };
            });

            // Store the last post's numeric ID as the cursor for page 2
            // (Feed API uses numeric post ID as max_id, not base64 end_cursor)
            if (edges.length > 0 && hasMore) {
                const lastPostId = edges[edges.length - 1]?.node?.id;
                if (lastPostId) {
                    cursorStore.set(`${username}:1`, lastPostId);
                }
            }

            const result: ChannelResult = { posts, hasMore };
            cache.set(cacheKey, { data: result, timestamp: Date.now() });
            evictExpiredCache();
            return result;
        }

        // ── Page 2+: feed API with cookies + max_id = last post numeric ID ───
        const cookieHeader = getInstagramCookieHeader();
        if (!cookieHeader) {
            return {
                posts: [],
                hasMore: false,
                error: 'Loading more posts requires Instagram cookies. Please add Instagram cookies to cookies.txt.',
            };
        }

        // Get cursor (last post ID) from previous page
        const prevCursorKey = `${username}:${page - 1}`;
        let maxId = cursorStore.get(prevCursorKey) || null;

        // If we don't have it, fetch page 1 first to bootstrap
        if (!maxId || !userIdStore.get(username)) {
            console.log(`[Instagram] Bootstrapping page 1 for ${username} to get cursor`);
            const profileUrl = `https://i.instagram.com/api/v1/users/web_profile_info/?username=${encodeURIComponent(username)}`;
            const profileRes = await igFetch(profileUrl); // No cookies
            if (!profileRes.ok) {
                return { posts: [], hasMore: false, error: `Instagram returned ${profileRes.status}` };
            }
            const profileData = await profileRes.json();
            const user = profileData?.data?.user;
            if (!user) {
                return { posts: [], hasMore: false, error: 'Instagram user not found' };
            }
            userIdStore.set(username, user.id);
            const edges = user.edge_owner_to_timeline_media?.edges || [];
            if (edges.length > 0) {
                const lastPostId = edges[edges.length - 1]?.node?.id;
                if (lastPostId) {
                    cursorStore.set(`${username}:1`, lastPostId);
                    if (page === 2) maxId = lastPostId;
                }
            }
        }

        if (!maxId) {
            return { posts: [], hasMore: false };
        }

        const userId = userIdStore.get(username);
        if (!userId) {
            return { posts: [], hasMore: false, error: 'Could not resolve Instagram user ID' };
        }

        const feedUrl = `https://i.instagram.com/api/v1/feed/user/${userId}/?count=${pageSize}&max_id=${encodeURIComponent(maxId)}`;
        console.log(`[Instagram] Feed API page ${page}: userId=${userId}, max_id=${maxId.slice(0, 20)}...`);

        const feedRes = await igFetch(feedUrl, cookieHeader);
        if (feedRes.status === 401 || feedRes.status === 403) {
            return {
                posts: [],
                hasMore: false,
                error: 'Instagram session expired. Please refresh your cookies.txt.',
            };
        }
        if (!feedRes.ok) {
            const text = await feedRes.text().catch(() => '');
            console.warn(`[Instagram] Feed API ${feedRes.status}: ${text.slice(0, 200)}`);
            return { posts: [], hasMore: false, error: `Instagram feed returned ${feedRes.status}` };
        }

        const feedData = await feedRes.json();
        const items: any[] = feedData?.items || [];
        const moreAvailable: boolean = feedData?.more_available || false;
        const nextMaxId: string | null = feedData?.next_max_id || null;

        const posts = items.map((item: any) => ({
            id: item.code || item.pk || item.id,
            title: (item.caption?.text || '').slice(0, 100),
            thumbnail: item.image_versions2?.candidates?.[0]?.url
                || item.carousel_media?.[0]?.image_versions2?.candidates?.[0]?.url
                || '',
            duration: item.video_duration || 0,
            url: item.code
                ? `https://www.instagram.com/p/${item.code}/`
                : `https://www.instagram.com/p/${item.pk}/`,
            platform: 'instagram',
        }));

        // Store cursor for next page: either next_max_id from response, or last item's ID
        const nextCursor = nextMaxId || (items.length > 0 ? String(items[items.length - 1].pk || items[items.length - 1].id || '') : null);
        if (nextCursor) {
            cursorStore.set(`${username}:${page}`, nextCursor);
        }

        const result: ChannelResult = { posts, hasMore: moreAvailable || !!nextMaxId };
        cache.set(cacheKey, { data: result, timestamp: Date.now() });
        evictExpiredCache();
        return result;

    } catch (err: any) {
        console.error('[Instagram] Service error:', err.message);
        const isAuthError = err.message?.toLowerCase().includes('login')
            || err.message?.includes('401')
            || err.message?.includes('403');
        return {
            posts: [],
            hasMore: false,
            error: isAuthError
                ? 'Loading more Instagram posts requires login. Please refresh your cookies.txt.'
                : 'Failed to fetch Instagram posts. Try again later.',
        };
    }
}
