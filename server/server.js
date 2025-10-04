// server.js
const path = require('path');
const ImprovedRedditService = require('./redditServiceV2');
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 5000;

// TMDB request helper
const tmdbRequest = async (endpoint, params = {}) => {
  try {
    const response = await axios.get(`https://api.themoviedb.org/3${endpoint}`, {
      params: {
        api_key: process.env.TMDB_API_KEY,
        ...params
      }
    });
    return response.data;
  } catch (error) {
    console.error(`TMDB request failed for ${endpoint}:`, error.message);
    throw error;
  }
};

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100
});

// Middleware
app.use(limiter);

app.use(cors({
  origin: process.env.NODE_ENV === 'production'
    ? ['*'] 
    : ['http://localhost:3000', 'http://127.0.0.1:5500', 'http://localhost:5500']
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, '../public')));

// TMDB API configuration
const TMDB_API_KEY = process.env.TMDB_API_KEY;
const TMDB_ACCESS_TOKEN = process.env.TMDB_ACCESS_TOKEN;

// Validation middleware
const validateQuery = (req, res, next) => {
  const { query } = req.query;
  if (!query || query.trim().length < 2) {
    return res.status(400).json({
      error: 'Query must be at least 2 characters long',
      code: 'INVALID_QUERY'
    });
  }
  next();
};

const validateParams = (req, res, next) => {
  const { type, id } = req.params;
  if (!['movie', 'tv'].includes(type)) {
    return res.status(400).json({ error: 'Type must be "movie" or "tv"', code: 'INVALID_TYPE' });
  }
  if (!/^\d+$/.test(id)) {
    return res.status(400).json({ error: 'ID must be numeric', code: 'INVALID_ID' });
  }
  next();
};

// Reddit Service init
let redditService = null;
if (TMDB_API_KEY && TMDB_ACCESS_TOKEN) {
  redditService = new ImprovedRedditService(TMDB_API_KEY, TMDB_ACCESS_TOKEN);
  if (redditService.isAvailable()) {
    console.log('✅ Reddit recommendations service initialized and authenticated');
  } else {
    console.log('⚠️  Reddit API credentials not configured - Reddit features disabled');
    redditService = null;
  }
}

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    tmdb_configured: !!(TMDB_API_KEY && TMDB_ACCESS_TOKEN),
    reddit_configured: redditService ? redditService.isAvailable() : false
  });
});

// AI Recommendations route
// Replace the /api/ai-recommendations route in server.js with this:

app.get('/api/ai-recommendations/:type/:id', validateParams, async (req, res) => {
  try {
    const { type, id } = req.params;
    const { comprehensive = 'false' } = req.query;

    // Get movie/show details
    let title = '', overview = '', releaseYear = '';
    const details = await tmdbRequest(`/${type}/${id}`);
    title = details.title || details.name;
    overview = details.overview;
    releaseYear = details.release_date && typeof details.release_date === 'string'
      ? details.release_date.split('-')[0]
      : details.first_air_date && typeof details.first_air_date === 'string'
        ? details.first_air_date.split('-')[0]
        : '';

    // Try Reddit recommendations first (only for movies)
    let redditRecommendations = [];
    let searchStats = { processingTime: 0, totalFound: 0, uniqueMovies: 0, sourcesUsed: [] };

    if (redditService && redditService.isAvailable() && type === 'movie') {
      try {
        const startTime = Date.now();
        redditRecommendations = (comprehensive === 'true')
          ? await redditService.getRecommendations(title, 30)
          : await redditService.getQuickRecommendations(title, 20);

        searchStats.processingTime = Date.now() - startTime;
        searchStats.totalFound = redditRecommendations.length;
        searchStats.uniqueMovies = redditRecommendations.length;
        searchStats.sourcesUsed = [...new Set(redditRecommendations.flatMap(r => r.subreddits || []))];

        console.log(`✅ Reddit search completed in ${searchStats.processingTime}ms`);
        console.log(`📊 Found ${searchStats.uniqueMovies} unique movies from ${searchStats.sourcesUsed.length} subreddits`);
      } catch (redditError) {
        console.error('Error getting Reddit recommendations:', redditError.message);
      }
    }

    // Build response based on what we have
    let allRecommendations = [];
    let tmdbRecommendations = [];

    if (redditRecommendations.length > 0) {
      // We have Reddit recommendations - use ONLY those
      console.log('✅ Using Reddit recommendations only');
      allRecommendations = redditRecommendations.map(rec => ({
        ...rec,
        source_type: 'reddit',
        reddit_data: {
          mentions: rec.mentions,
          avgConfidence: rec.avgConfidence,
          subreddits: rec.subreddits,
          contexts: rec.contexts,
          finalScore: rec.finalScore,
          redditUrls: rec.redditUrls
        }
      }));
    } else {
      // No Reddit recommendations - fall back to TMDB
      console.log('⚠️ No Reddit recommendations, falling back to TMDB');
      try {
        const tmdbData = await tmdbRequest(`/${type}/${id}/recommendations`);
        tmdbRecommendations = tmdbData.results.filter(item => item.poster_path);
        if (tmdbRecommendations.length === 0) {
          const similarData = await tmdbRequest(`/${type}/${id}/similar`);
          tmdbRecommendations = similarData.results.filter(item => item.poster_path);
        }
        
        allRecommendations = tmdbRecommendations.map(rec => ({
          ...rec,
          source_type: 'tmdb',
          reddit_data: null
        }));
      } catch (tmdbError) {
        console.error('Error fetching TMDB recommendations:', tmdbError.message);
      }
    }

    res.json({
      title,
      overview,
      release_year: releaseYear,
      type,
      recommendations: allRecommendations.slice(0, 50),
      search_stats: searchStats,
      metadata: {
        total_recommendations: allRecommendations.length,
        reddit_recommendations: redditRecommendations.length,
        tmdb_recommendations: tmdbRecommendations.length,
        has_reddit_data: redditRecommendations.length > 0,
        comprehensive_search: comprehensive === 'true',
        reddit_available: redditService ? redditService.isAvailable() : false
      }
    });
  } catch (error) {
    console.error('AI recommendations error:', error.message);
    res.status(500).json({ error: 'Failed to fetch recommendations', code: 'INTERNAL_ERROR' });
  }
});

//here
app.get('/api/test-reddit/:movieTitle', async (req, res) => {
  try {
    const { movieTitle } = req.params;
    if (!redditService || !redditService.isAvailable()) {
      return res.status(503).json({ error: 'Reddit service not available', code: 'SERVICE_UNAVAILABLE' });
    }
    console.log(`🧪 Testing Reddit extraction for: ${movieTitle}`);
    const recommendations = await redditService.getQuickRecommendations(movieTitle, 20);
    
    res.json({
      movie_title: movieTitle,
      found_recommendations: recommendations.length,
      recommendations: recommendations.map(rec => {
        // Safer year extraction
        let year = 'Unknown';
        try {
          if (rec.release_date) {
            if (typeof rec.release_date === 'string' && rec.release_date.includes('-')) {
              year = rec.release_date.split('-')[0];
            } else if (typeof rec.release_date === 'number') {
              year = rec.release_date.toString();
            }
          }
        } catch (e) {
          console.error('Error extracting year:', e);
        }
        
        return {
          title: rec.title || 'Unknown',
          year: year,
          score: rec.vote_average || 0,
          mentions: rec.mentions || 0,
          confidence: rec.avgConfidence ? Math.round(rec.avgConfidence * 100) + '%' : '0%',
          subreddits: rec.subreddits || [],
          reddit_urls: rec.redditUrls || [],
          final_score: rec.finalScore ? rec.finalScore.toFixed(2) : null
        };
      })
    });
  } catch (error) {
    console.error('Test Reddit extraction error:', error.message);
    console.error('Stack:', error.stack); // Add stack trace
    res.status(500).json({ error: 'Failed to test Reddit extraction: ' + error.message, code: 'INTERNAL_ERROR' });
  }
});

// TMDB search
app.get('/api/search', validateQuery, async (req, res) => {
  try {
    const { query, type = 'multi', page = 1 } = req.query;
    const data = await tmdbRequest(`/search/${type}`, { query: query.trim(), page: Math.min(page, 1000) });
    res.json({ ...data, results: data.results.filter(item => item.poster_path) });
  } catch (error) {
    console.error('Search error:', error.message);
    res.status(500).json({ error: 'Search failed', code: 'INTERNAL_ERROR' });
  }
});

// TMDB recommendations
app.get('/api/recommendations/:type/:id', validateParams, async (req, res) => {
  try {
    const { type, id } = req.params;
    const { page = 1 } = req.query;
    const data = await tmdbRequest(`/${type}/${id}/recommendations`, { page: Math.min(page, 1000) });
    res.json({ ...data, results: data.results.filter(item => item.poster_path) });
  } catch (error) {
    console.error('Recommendations error:', error.message);
    res.status(500).json({ error: 'Recommendations failed', code: 'INTERNAL_ERROR' });
  }
});

// Popular
app.get('/api/popular', async (req, res) => {
  try {
    const { page = 1 } = req.query;
    const [moviesResponse, tvResponse] = await Promise.all([
      tmdbRequest('/movie/popular', { page: Math.min(page, 1000) }),
      tmdbRequest('/tv/popular', { page: Math.min(page, 1000) })
    ]);
    res.json({
      movies: moviesResponse.results.filter(item => item.poster_path).slice(0, 10),
      tv: tvResponse.results.filter(item => item.poster_path).slice(0, 10)
    });
  } catch (error) {
    console.error('Popular items error:', error.message);
    res.status(500).json({ error: 'Popular fetch failed', code: 'INTERNAL_ERROR' });
  }
});

// Details
app.get('/api/details/:type/:id', validateParams, async (req, res) => {
  try {
    const { type, id } = req.params;
    const data = await tmdbRequest(`/${type}/${id}`, { append_to_response: 'credits,videos,similar' });
    res.json(data);
  } catch (error) {
    console.error('Details error:', error.message);
    res.status(500).json({ error: 'Details fetch failed', code: 'INTERNAL_ERROR' });
  }
});

// Trending
app.get('/api/trending/:timeWindow?', async (req, res) => {
  try {
    const { timeWindow = 'day' } = req.params;
    if (!['day', 'week'].includes(timeWindow)) {
      return res.status(400).json({ error: 'Invalid time window', code: 'INVALID_TIME_WINDOW' });
    }
    const data = await tmdbRequest(`/trending/all/${timeWindow}`);
    res.json({ ...data, results: data.results.filter(item => item.poster_path) });
  } catch (error) {
    console.error('Trending error:', error.message);
    res.status(500).json({ error: 'Trending fetch failed', code: 'INTERNAL_ERROR' });
  }
});

// Static frontend
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

// Error handler
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error', code: 'INTERNAL_ERROR' });
});

// 404 handler
app.use('/api/*', (req, res) => {
  res.status(404).json({ error: 'API endpoint not found', code: 'NOT_FOUND' });
});

// Add to server.js
app.get('/api/test-reddit-raw', async (req, res) => {
  if (!redditService || !redditService.isAvailable()) {
    return res.json({ error: 'Reddit service not available' });
  }
  
  try {
    const sub = await redditService.reddit.getSubreddit('MovieSuggestions');
    const hot = await sub.getHot({ limit: 3 });
    
    res.json({
      success: true,
      posts: hot.map(p => ({
        title: p.title,
        score: p.score,
        author: p.author?.name || 'unknown'
      }))
    });
  } catch (error) {
    res.json({
      success: false,
      error: error.message,
      stack: error.stack
    });
  }
});

// Start
app.listen(PORT, () => {
  console.log(`🎬 Got Next server is running on port ${PORT}`);
  console.log(`🌐 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`🎯 API available at: http://localhost:${PORT}/api`);
});
