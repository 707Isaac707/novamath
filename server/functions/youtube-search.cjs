exports.handler = async function(event) {
  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'public, max-age=60'
  };

  try {
    const apiKey = process.env.YOUTUBE_API_KEY;
    if (!apiKey) {
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({ error: 'YouTube search is not configured on the server.' })
      };
    }

    const query = String(event.queryStringParameters?.q || '').trim();
    if (!query) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing search query.' }) };
    }

    const params = new URLSearchParams({
      part: 'snippet',
      q: query,
      type: 'video',
      maxResults: '12',
      videoEmbeddable: 'true',
      videoSyndicated: 'true',
      videoCategoryId: '10',
      regionCode: 'US',
      safeSearch: 'moderate',
      key: apiKey
    });

    const response = await fetch(`https://www.googleapis.com/youtube/v3/search?${params.toString()}`);
    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      const message = data?.error?.message || `YouTube API request failed: ${response.status}`;
      return { statusCode: response.status, headers, body: JSON.stringify({ error: message }) };
    }

    const items = (Array.isArray(data.items) ? data.items : [])
      .filter(item => item?.id?.videoId)
      .map(item => ({
        id: item.id.videoId,
        title: item.snippet?.title || 'YouTube video',
     ¶»§q«^