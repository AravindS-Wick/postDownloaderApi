/**
 * Twitter/X service — fetches user posts via Twitter's syndication API.
 * No authentication required. Includes 5-minute caching and 429 retry.
 */

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

// In-memory cache
const cache = new Map<string, { data: ChannelResult; timestamp: number }>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes
const MAX_CACHE_SIZE = 50;
let lastRequestTime = 0;
const MIN_REQUEST_GAP = 2000; // 2 seconds between requests (Twitter is stricter)

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

async function httpGet(url: string, retries = 2): Promise<Response> {
    const now = Date.now();
    const elapsed = now - lastRequestTime;
    if (elapsed < MIN_REQUEST_GAP) {
        await new Promise(r => setTimeout(r, MIN_REQUEST_GAP - elapsed));
    }
    lastRequestTime = Date.now();

    const headers: Record<string, string> = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
    };

    for (let attempt = 0; attempt <= retries; attempt++) {
        const res = await fetch(url, { headers });
        if (res.status === 429 && attempt < retries) {
            const delay = attempt === 0 ? 5000 : 10000;
            console.warn(`Twitter 429 — retrying in ${delay / 1000}s (attempt ${attempt + 1}/${retries})`);
            await new Promise(r => setTimeout(r, delay));
            continue;
        }
        return res;
    }
    throw new Error('Twitter request failed after retries');
}

function extractUsername(url: string): string | null {
    // Handle x.com/username, twitter.com/username
    const match = url.match(/(?:twitter\.com|x\.com)\/([^/?#]+)/i);
    if (!match) return null;
    const name = match[1].toLowerCase();
    if (['home', 'explore', 'search', 'settings', 'i', 'intent', 'hashtag'].includes(name)) return null;
    return name;
}

export async function getTwitterUserPosts(url: string, page: number, pageSize: number): Promise<ChannelResult> {
    const username = extractUsername(url);
    if (!username) {
        return { posts: [], hasMore: false, error: 'Could not extract Twitter/X username from URL' };
    }

    // Only page 1 supported via syndication API
    if (page > 1) {
        return { posts: [], hasMore: false };
    }

    const cacheKey = `${username}:${page}`;
    const cached = cache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
        return cached.data;
    }

    try {
        const syndicationUrl = `https://syndication.twitter.com/srv/timeline-profile/screen-name/${encodeURIComponent(username)}`;
        const res = await httpGet(syndicationUrl);
        if (!res.ok) {
            return { posts: [], hasMore: false, error: `Twitter returned ${res.status}` };
        }

        const html = await res.text();
        let posts: PostItem[] = [];

        // Try parsing __NEXT_DATA__ JSON
        const nextDataMatch = html.match(/<script id="__NEXT_DATA__"[^>]*>(.*?)<\/script>/s);
        if (nextDataMatch) {
            try {
                const nextData = JSON.parse(nextDataMatch[1]);
                const timeline = nextData?.props?.pageProps?.timeline;
                const entries = timeline?.entries || [];

                posts = entries
                    .filter((entry: any) => entry?.content?.tweet)
                    .slice(0, pageSize)
                    .map((entry: any) => {
                        const tweet = entry.content.tweet;
                        const tweetId = tweet.id_str || tweet.id;
                        const text = (tweet.full_text || tweet.text || '').slice(0, 100);
                        const media = tweet.entities?.media?.[0];
                        const thumbnail = media?.media_url_https || '';
                        const video = tweet.extended_entities?.media?.[0]?.video_info;
                        const duration = video ? Math.round((video.duration_millis || 0) / 1000) : 0;

                        return {
                            id: tweetId,
                            title: text,
                            thumbnail,
                            duration,
                            url: `https://twitter.com/${username}/status/${tweetId}`,
                            platform: 'twitter',
                        };
                    });
            } catch {
                // Fall through to HTML parsing
            }
        }

        // Fallback: extract tweet IDs from HTML
        if (posts.length === 0) {
            const tweetIdPattern = /\/status\/(\d+)/g;
            const ids = new Set<string>();
            let m;
            while ((m = tweetIdPattern.exec(html)) !== null) {
                ids.add(m[1]);
            }
            posts = [...ids].slice(0, pageSize).map(id => ({
                id,
                title: '',
                thumbnail: '',
                duration: 0,
                url: `https://twitter.com/${username}/status/${id}`,
                platform: 'twitter',
            }));
        }

        const result: ChannelResult = { posts, hasMore: false };
        cache.set(cacheKey, { data: result, timestamp: Date.now() });
        evictExpiredCache();
        return result;
    } catch (err: any) {
        console.error('Twitter service error:', err.message);
        return { posts: [], hasMore: false, error: 'Failed to fetch Twitter/X posts. Try again later.' };
    }
}
