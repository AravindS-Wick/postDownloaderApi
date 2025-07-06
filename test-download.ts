import axios from 'axios';

interface DownloadResponse {
    success: boolean;
    error?: string;
    downloadUrl?: string;
    filename?: string;
    title?: string;
    channel?: string;
    length?: string;
}

async function testDownload() {
    try {
        // Test YouTube download
        const response = await axios.post<DownloadResponse>('http://localhost:2500/api/download', {
            url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
            type: 'video'
        });

        const result = response.data;
        console.log('Download result:', result);

        if (!result.success) {
            console.error('Download failed:', result.error);
            return;
        }

        console.log('Download successful!');
        console.log('File URL:', result.downloadUrl);
        console.log('Metadata:', {
            title: result.title,
            channel: result.channel,
            length: result.length
        });
    } catch (error) {
        console.error('Test failed:', error);
    }
}

testDownload(); 
