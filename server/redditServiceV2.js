// server/redditServiceV2.js - Improved extraction for accurate recommendations
const snoowrap = require('snoowrap');
const axios = require('axios');

class ImprovedRedditService {
  constructor(tmdbApiKey, tmdbAccessToken) {
    this.tmdbApiKey = tmdbApiKey;
    this.tmdbAccessToken = tmdbAccessToken;
    this.tmdbBaseUrl = 'https://api.themoviedb.org/3';

    try {
        const clientId = process.env.REDDIT_CLIENT_ID;
        const clientSecret = process.env.REDDIT_CLIENT_SECRET;
        const username = process.env.REDDIT_USERNAME;
        const password = process.env.REDDIT_PASSWORD;

        if (!clientId || !clientSecret || !username || !password) {
            console.warn('⚠️ Reddit credentials incomplete');
            this.reddit = null;
            return;
        }

        const userAgent = `web:got-next-app:v1.0.0 (by /u/${username.trim()})`;
        
        this.reddit = new snoowrap({
            userAgent: userAgent,
            clientId: clientId.trim(),
            clientSecret: clientSecret.trim(),
            username: username.trim(),
            password: password.trim(),
        });

        console.log('✅ Reddit API client initialized successfully');
    } catch (error) {
        console.error('❌ Failed to initialize Reddit client:', error.message);
        this.reddit = null;
    }

    this.cache = new Map();
    this.cacheExpiry = 24 * 60 * 60 * 1000;
  }

  isAvailable() {
    return this.reddit !== null;
  }

  async getCached(key, fetcher) {
    const cached = this.cache.get(key);
    if (cached && Date.now() - cached.timestamp < this.cacheExpiry) {
      console.log(`📦 Cache hit for: ${key}`);
      return cached.data;
    }

    const data = await fetcher();
    this.cache.set(key, { data, timestamp: Date.now() });
    return data;
  }

  async searchAndValidateTMDB(title) {
    if (!title) return [];
    const cacheKey = `tmdb_${title.toLowerCase()}`;

    return this.getCached(cacheKey, async () => {
      try {
        const response = await axios.get(`${this.tmdbBaseUrl}/search/movie`, {
          headers: { Authorization: `Bearer ${this.tmdbAccessToken}` },
          params: { api_key: this.tmdbApiKey, query: title, include_adult: false },
          timeout: 10000,
        });

        return (response.data.results || [])
          .filter((m) => m && m.title && m.poster_path && m.vote_average > 0)
          .slice(0, 3);
      } catch (error) {
        console.error(`❌ TMDB search error for "${title}":`, error.message || error);
        return [];
      }
    });
  }

  isLikelyRecommendationPost(title, movieTitle) {
    const lowerTitle = title.toLowerCase();
    const lowerMovie = movieTitle.toLowerCase();
    
    // Must contain the movie name
    if (!lowerTitle.includes(lowerMovie)) return false;
    
    // Must have recommendation intent keywords
    const recommendKeywords = [
      'similar', 'like', 'recommendations', 'suggest', 'looking for',
      'movies like', 'films like', 'if you liked', 'enjoyed'
    ];
    
    return recommendKeywords.some(keyword => lowerTitle.includes(keyword));
  }

  async extractRecommendationsFromPost(text, originalTitle) {
    if (!text || typeof text !== 'string') return [];
    
    const potentialTitles = new Set();
    
    // Split into lines to catch plain list format
    const lines = text.split('\n');
    
    // Pattern 1: Lines that are just movie titles (most common on Reddit)
    lines.forEach(line => {
        const trimmed = line.trim();
        // Match lines that start with capital and are 3-50 chars
        if (/^[A-Z][A-Za-z0-9\s&:'.!?-]{2,49}$/.test(trimmed)) {
            potentialTitles.add(trimmed);
        }
    });
    
    // Pattern 2: Bold text
    const boldPattern = /\*\*([A-Z][A-Za-z0-9\s&:'.!?-]{2,50})\*\*/g;
    let match;
    while ((match = boldPattern.exec(text)) !== null) {
        potentialTitles.add(match[1].trim());
    }
    
    // Pattern 3: With year
    const yearPattern = /([A-Z][A-Za-z0-9\s&:'.!?-]{2,50})\s*\((\d{4})\)/g;
    while ((match = yearPattern.exec(text)) !== null) {
        potentialTitles.add(match[1].trim());
    }
    
    // Pattern 4: Quoted
    const quotedPattern = /"([A-Z][A-Za-z0-9\s&:'.!?-]{2,50})"/g;
    while ((match = quotedPattern.exec(text)) !== null) {
        potentialTitles.add(match[1].trim());
    }
    
    // Pattern 5: After action words
    const actionPattern = /(?:watch|try|recommend|check out|see)\s+([A-Z][A-Za-z0-9\s&:'.!?-]{3,40})/gi;
    while ((match = actionPattern.exec(text)) !== null) {
        potentialTitles.add(match[1].trim());
    }

    // Filter aggressively
    const filtered = Array.from(potentialTitles).filter((t) => {
      const lower = t.toLowerCase();
      const orig = originalTitle.toLowerCase();
      
      if (lower === orig) return false;
      
      // Skip common non-movie phrases
      const skipPhrases = [
        'reddit', 'edit', 'thanks', 'update', 'the movie', 'the film',
        'any movie', 'some movie', 'also', 'maybe', 'really', 'very',
        'just like', 'something like', 'similar to', 'anything'
      ];
      
      if (skipPhrases.some(phrase => lower === phrase || lower.includes(phrase))) return false;
      
      // Must be at least 2 words OR a known single-word title
      const words = t.trim().split(/\s+/);
      const singleWordTitles = ['up', 'her', 'it', 'arrival', 'dunkirk', 'frozen', 'tangled', 'brave', 'coco'];
      if (words.length < 2 && !singleWordTitles.includes(lower)) return false;
      
      return /[A-Za-z]{2,}/.test(t);
    });

    // Validate with TMDB - limit to 15
    const validated = [];
    for (const title of filtered.slice(0, 15)) {
      try {
        const tmdbResults = await this.searchAndValidateTMDB(title);
        if (tmdbResults.length > 0) {
          validated.push({
            extractedTitle: title,
            tmdbMatch: tmdbResults[0],
            confidence: this.calculateMatchConfidence(title, tmdbResults[0].title),
          });
        }
      } catch (error) {
        // Continue on error
      }
      await this.sleep(50);
    }

    return validated;
  }

  calculateMatchConfidence(extracted, tmdbTitle) {
    if (!extracted || !tmdbTitle) return 0;
    const e = String(extracted).toLowerCase().trim();
    const t = String(tmdbTitle).toLowerCase().trim();
    if (e === t) return 1.0;
    
    const cleanE = e.replace(/^(the|a|an)\s+/i, '');
    const cleanT = t.replace(/^(the|a|an)\s+/i, '');
    if (cleanE === cleanT) return 0.95;
    
    const eWords = new Set(cleanE.split(/\s+/));
    const tWords = new Set(cleanT.split(/\s+/));
    let common = 0;
    eWords.forEach((word) => {
      if (tWords.has(word) && word.length > 2) common++;
    });
    
    return common / (Math.max(eWords.size, tWords.size) || 1);
  }

  async getQuickRecommendations(movieTitle, limit = 20) {
    if (!this.isAvailable()) return [];

    try {
        console.log(`🔍 Searching for movies like: ${movieTitle}`);
        const recommendations = new Map();
        
        // Simple, direct search
        const query = `movies like ${movieTitle}`;
        
        const results = await this.reddit
            .getSubreddit('MovieSuggestions')
            .search({
                query: query,
                sort: 'relevance',
                time: 'all',
                limit: 10
            });
        
        const resultsArray = Array.isArray(results) ? results : Array.from(results || []);
        console.log(`📊 Found ${resultsArray.length} posts`);
        
        for (const post of resultsArray) {
            const titleText = post?.title || '';
            
            // Must mention the movie in title
            if (!titleText.toLowerCase().includes(movieTitle.toLowerCase())) {
                continue;
            }
            
            console.log(`\n✅ "${titleText}"`);
            console.log(`   Comments: ${post.num_comments}`);
            
            // FOCUS ON COMMENTS - that's where recommendations are
            if (post.num_comments > 0) {
                try {
                    console.log(`   Fetching submission ${post.id}...`);
                    
                    // Fetch the submission with comments
                    const submission = await this.reddit.getSubmission(post.id).fetch();
                    
                    console.log(`   Submission fetched, checking comments...`);
                    console.log(`   Comments type: ${typeof submission.comments}`);
                    console.log(`   Comments is array: ${Array.isArray(submission.comments)}`);
                    
                    let comments = submission.comments || [];
                    
                    // Try to convert to array if it's not
                    if (!Array.isArray(comments)) {
                        if (comments && typeof comments[Symbol.iterator] === 'function') {
                            comments = Array.from(comments);
                        } else {
                            console.log(`   ⚠️ Comments is not iterable`);
                            continue;
                        }
                    }
                    
                    console.log(`   Processing ${comments.length} comments...`);
                    
                    if (comments.length === 0) {
                        console.log(`   ⚠️ No comments found despite post having ${post.num_comments} comments`);
                        continue;
                    }
                    
                    let foundMoviesCount = 0;
                    
                    for (let i = 0; i < Math.min(comments.length, 30); i++) {
                        const comment = comments[i];
                        
                        if (!comment || !comment.body || typeof comment.body !== 'string') {
                            continue;
                        }
                        
                        // Skip very short comments
                        if (comment.body.length < 10) continue;
                        
                        // Show first few characters of comment for debugging
                        if (i < 3) {
                            console.log(`   Comment ${i}: "${comment.body.substring(0, 50)}..."`);
                        }
                        
                        const commentMovies = await this.extractRecommendationsFromPost(
                            comment.body,
                            movieTitle
                        );
                        
                        if (commentMovies.length > 0) {
                            foundMoviesCount += commentMovies.length;
                            console.log(`   ✅ Found ${commentMovies.length} movies: ${commentMovies.map(m => m.tmdbMatch.title).join(', ')}`);
                        }
                        
                        commentMovies.forEach((movie) => {
                            if (!movie?.tmdbMatch) return;
                            this.addOrUpdateRecommendation(recommendations, movie, {
                                source: 'comment',
                                subreddit: 'MovieSuggestions',
                                score: comment.score || 1,
                                url: post?.permalink ? `https://reddit.com${post.permalink}` : '#',
                            });
                        });
                    }
                    
                    console.log(`   Total movies found in this post: ${foundMoviesCount}`);
                    
                } catch (commentError) {
                    console.log('   ⚠️ Could not fetch comments:', commentError.message);
                    console.log('   Stack:', commentError.stack);
                }
            }
            
            if (recommendations.size >= limit) break;
            
            await this.sleep(2000); // Longer delay for comment fetching
        }

        const finalResults = Array.from(recommendations.values())
            .sort((a, b) => (b.finalScore || 0) - (a.finalScore || 0))
            .slice(0, limit);
            
        console.log(`\n✅ Final: ${finalResults.length} unique recommendations`);
        return finalResults;
        
    } catch (err) {
        console.error('❌ Search error:', err.message);
        return [];
    }
  }

  async getRecommendations(movieTitle, limit = 30) {
    if (!this.isAvailable()) return [];

    const cacheKey = `reddit_recs_${movieTitle.toLowerCase()}`;
    return this.getCached(cacheKey, async () => {
        const recommendations = new Map();
        const subreddits = ['MovieSuggestions', 'ifyoulikeblank'];
        
        for (const subreddit of subreddits) {
            const query = `movies like ${movieTitle}`;
            
            try {
                console.log(`🔍 Searching r/${subreddit}`);
                const results = await this.reddit.getSubreddit(subreddit).search({
                    query,
                    sort: 'relevance',
                    time: 'all',
                    limit: 10,
                });

                const resultsArray = Array.isArray(results) ? results : Array.from(results || []);
                console.log(`   Found ${resultsArray.length} posts`);

                for (const post of resultsArray) {
                    const titleText = post?.title || '';
                    
                    // Must mention the movie
                    if (!titleText.toLowerCase().includes(movieTitle.toLowerCase())) {
                        continue;
                    }
                    
                    // Get comments
                    if (post.num_comments > 0) {
                        try {
                            const submission = await this.reddit.getSubmission(post.id).fetch();
                            let comments = submission.comments || [];
                            
                            if (!Array.isArray(comments) && comments && typeof comments[Symbol.iterator] === 'function') {
                                comments = Array.from(comments);
                            }
                            
                            for (let i = 0; i < Math.min(comments.length, 15); i++) { // Reduced from 30 to 15
                                const comment = comments[i];
                                if (!comment?.body || comment.body.length < 10) continue;
                                
                                const movies = await this.extractRecommendationsFromPost(comment.body, movieTitle);
                                
                                movies.forEach((movie) =>
                                    this.addOrUpdateRecommendation(recommendations, movie, {
                                        source: 'comment',
                                        subreddit,
                                        score: comment.score || 0,
                                        url: `https://reddit.com${post.permalink}`,
                                    })
                                );
                            }
                        } catch (commentError) {
                            console.log(`   ⚠️ Comment error: ${commentError.message}`);
                        }
                    }
                }

                await this.sleep(2000);
            } catch (err) {
                console.error(`❌ Error in r/${subreddit}:`, err.message);
            }
        }

        const finalResults = Array.from(recommendations.values())
            .sort((a, b) => (b.finalScore || 0) - (a.finalScore || 0))
            .slice(0, limit);
            
        console.log(`✅ Total: ${finalResults.length} recommendations`);
        return finalResults;
    });
  }

  addOrUpdateRecommendation(map, movie, context) {
    if (!movie?.tmdbMatch?.id) return;
    const id = movie.tmdbMatch.id;

    if (!map.has(id)) {
      map.set(id, {
        ...movie.tmdbMatch,
        mentions: 1,
        totalConfidence: movie.confidence || 0,
        contexts: [context],
        subredditsSet: new Set([context.subreddit]), // Keep as Set internally
        sources: [context.source],
        redditUrls: [context.url],
      });
    } else {
      const existing = map.get(id);
      existing.mentions++;
      existing.totalConfidence += movie.confidence || 0;
      
      // Use Set for subreddits
      if (!existing.subredditsSet) {
        existing.subredditsSet = new Set(existing.subreddits || []);
      }
      existing.subredditsSet.add(context.subreddit);
      
      existing.sources.push(context.source);
      if (!existing.redditUrls.includes(context.url)) existing.redditUrls.push(context.url);
      if (existing.contexts.length < 3) existing.contexts.push(context);
    }

    const rec = map.get(id);
    rec.avgConfidence = rec.mentions ? rec.totalConfidence / rec.mentions : 0;
    rec.finalScore = rec.avgConfidence * Math.log(rec.mentions + 1) * ((rec.vote_average || 0) / 10);
    
    // Convert Set to Array for final output
    rec.subreddits = Array.from(rec.subredditsSet);
    delete rec.subredditsSet; // Clean up internal Set
  }

  sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

module.exports = ImprovedRedditService;