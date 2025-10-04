// server/redditServiceV2.js - Optimized for maximum movie extraction
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

  async searchAndValidateTMDB(title, year = null) {
    if (!title) return [];
    const cacheKey = year ? `tmdb_${title.toLowerCase()}_${year}` : `tmdb_${title.toLowerCase()}`;

    return this.getCached(cacheKey, async () => {
      try {
        const params = { 
          api_key: this.tmdbApiKey, 
          query: title, 
          include_adult: false 
        };
        
        // Add year filter if provided
        if (year) {
          params.year = year;
          params.primary_release_year = year;
        }
        
        const response = await axios.get(`${this.tmdbBaseUrl}/search/movie`, {
          headers: { Authorization: `Bearer ${this.tmdbAccessToken}` },
          params: params,
          timeout: 10000,
        });

        let results = (response.data.results || [])
          .filter((m) => m && m.title && m.poster_path && m.vote_average > 0);
        
        // If year provided, prioritize exact year matches
        if (year && results.length > 0) {
          const exactYearMatch = results.find(m => {
            const releaseYear = m.release_date ? m.release_date.split('-')[0] : null;
            return releaseYear === year;
          });
          
          if (exactYearMatch) {
            // Put exact match first
            return [exactYearMatch, ...results.filter(m => m.id !== exactYearMatch.id)].slice(0, 3);
          }
        }
        
        return results.slice(0, 3);
      } catch (error) {
        console.error(`❌ TMDB search error for "${title}":`, error.message || error);
        return [];
      }
    });
  }

  async extractRecommendationsFromPost(text, originalTitle) {
    if (!text || typeof text !== 'string') return [];
    
    const potentialTitles = new Set();
    const lines = text.split('\n');
    
    // Pattern 1: Plain lines (most common format)
    const titlesWithYears = new Map(); // Track which titles have years
    
    lines.forEach(line => {
        const trimmed = line.trim();
        
        // Match with year
        const lineWithYear = /^([A-Z][A-Za-z0-9\s&:'.!?-]{2,49})\s*\((\d{4})\)$/.exec(trimmed);
        if (lineWithYear) {
            const title = lineWithYear[1].trim();
            const year = lineWithYear[2];
            potentialTitles.add(title);
            titlesWithYears.set(title, year); // Store the year for validation
        } else if (/^[A-Z][A-Za-z0-9\s&:'.!?-]{2,49}$/.test(trimmed)) {
            // Plain title without year
            potentialTitles.add(trimmed);
        }
    });
    
    // Pattern 2: Bullet points - Match both formats
    const bulletPattern = /^[\s]*[-*•]\s*([A-Z][A-Za-z0-9\s&:'.!?-]{2,49})/gm;
    let match;
    while ((match = bulletPattern.exec(text)) !== null) {
        potentialTitles.add(match[1].trim());
    }
    
    // Pattern 3: Numbered lists
    const numberedPattern = /^\d+[\.\)]\s*([A-Z][A-Za-z0-9\s&:'.!?-]{2,49})/gm;
    while ((match = numberedPattern.exec(text)) !== null) {
        potentialTitles.add(match[1].trim());
    }
    
    // Pattern 4: Bold text
    const boldPattern = /\*\*([A-Z][A-Za-z0-9\s&:'.!?-]{2,50})\*\*/g;
    while ((match = boldPattern.exec(text)) !== null) {
        potentialTitles.add(match[1].trim());
    }
    
    // Pattern 5: With year - extract and store year mapping
    const yearPattern = /([A-Z][A-Za-z0-9\s&:'.!?-]{2,50})\s*\((\d{4})\)/g;
    while ((match = yearPattern.exec(text)) !== null) {
        const title = match[1].trim();
        const year = match[2];
        potentialTitles.add(title);
        titlesWithYears.set(title, year);
    }
    
    // Pattern 6: Quoted
    const quotedPattern = /"([A-Z][A-Za-z0-9\s&:'.!?-]{2,50})"/g;
    while ((match = quotedPattern.exec(text)) !== null) {
        potentialTitles.add(match[1].trim());
    }
    
    // Pattern 7: After action words
    const actionPattern = /(?:watch|try|recommend|check out|see|loved)\s+([A-Z][A-Za-z0-9\s&:'.!?-]{3,40})/gi;
    while ((match = actionPattern.exec(text)) !== null) {
        potentialTitles.add(match[1].trim());
    }

    console.log(`  📝 Extracted ${potentialTitles.size} potential titles`);

    // More lenient filtering
    const filtered = Array.from(potentialTitles).filter((t) => {
      const lower = t.toLowerCase();
      const orig = originalTitle.toLowerCase();
      
      // Don't filter out the original movie
      if (lower === orig || lower.includes(orig) || orig.includes(lower)) return false;
      
      // Clean up parenthetical text
      const cleaned = t.replace(/\s*\([^)]*\)\s*/g, '').trim();
      if (cleaned.length < 2) return false;
      
      // Skip obvious non-movies
      const skipPhrases = [
        'reddit', 'edit', 'thanks', 'update', 'thread', 'subreddit',
        'the movie', 'the film', 'this movie', 'that movie',
        'any movie', 'some movie', 'something like'
      ];
      
      if (skipPhrases.some(phrase => lower === phrase)) return false;
      
      // Expanded single-word movie whitelist
      const singleWordTitles = [
        'up', 'her', 'it', 'arrival', 'dunkirk', 'frozen', 'tangled', 
        'brave', 'coco', 'soul', 'cars', 'willow', 'elf', 'jaws', 
        'alien', 'rocky', 'halloween', 'scream', 'saw', 'them', 'us',
        'heat', 'drive', 'gone', 'gravity', 'hugo', 'super', 'wanted',
        'split', 'nerve', 'bright', 'anon', 'mute', 'life', 'joy',
        'whiplash', 'baby', 'rush', 'chef', 'limitless', 'warrior',
        'contact', 'unforgiven', 'collateral', 'crash', 'sideways', 
        'barbarian', 'snowfall', 'serendipity'
      ];
      
      const words = t.trim().split(/\s+/);
      if (words.length < 2 && !singleWordTitles.includes(lower)) {
        return false;
      }
      
      // Must contain actual letters
      return /[A-Za-z]{2,}/.test(t);
    });

    console.log(`  🔍 ${filtered.length} titles after filtering`);

    // Validate with TMDB in parallel batches, using years when available
    // Process ALL filtered titles, not just first 30
    const validated = [];
    const batchSize = 5;
    
    for (let i = 0; i < filtered.length; i += batchSize) {
        const batch = filtered.slice(i, i + batchSize);
        
        const results = await Promise.all(
            batch.map(async title => {
                try {
                    const year = titlesWithYears.get(title);
                    const tmdbResults = await this.searchAndValidateTMDB(title, year);
                    
                    if (tmdbResults.length > 0) {
                        const matchedMovie = tmdbResults[0];
                        const movieYear = matchedMovie.release_date ? matchedMovie.release_date.split('-')[0] : 'Unknown';
                        console.log(`  ✅ "${title}"${year ? ` (${year})` : ''} → "${matchedMovie.title}" (${movieYear})`);
                        return {
                            extractedTitle: title,
                            tmdbMatch: matchedMovie,
                            confidence: this.calculateMatchConfidence(title, matchedMovie.title),
                        };
                    } else {
                        console.log(`  ❌ No match: "${title}"${year ? ` (${year})` : ''}`);
                        return null;
                    }
                } catch (error) {
                    console.log(`  ⚠️ Error for "${title}": ${error.message}`);
                    return null;
                }
            })
        );
        
        results.forEach(result => {
            if (result) validated.push(result);
        });
        
        await this.sleep(100);
    }

    console.log(`  ✅ ${validated.length} movies validated via TMDB`);
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
        
        const query = `movies like ${movieTitle}`;
        
        const results = await this.reddit
            .getSubreddit('MovieSuggestions')
            .search({
                query: query,
                sort: 'relevance',
                time: 'all',
                limit: 15  // Increased from 10
            });
        
        const resultsArray = Array.isArray(results) ? results : Array.from(results || []);
        console.log(`📊 Found ${resultsArray.length} posts`);
        
        for (const post of resultsArray) {
            const titleText = post?.title || '';
            
            if (!titleText.toLowerCase().includes(movieTitle.toLowerCase())) {
                continue;
            }
            
            console.log(`\n✅ "${titleText}"`);
            console.log(`   Comments: ${post.num_comments}`);
            
            if (post.num_comments > 0) {
                try {
                    const submission = await this.reddit.getSubmission(post.id).fetch();
                    let comments = submission.comments || [];
                    
                    if (!Array.isArray(comments)) {
                        if (comments && typeof comments[Symbol.iterator] === 'function') {
                            comments = Array.from(comments);
                        } else {
                            continue;
                        }
                    }
                    
                    console.log(`   Processing ${Math.min(comments.length, 50)} comments...`);
                    
                    let foundMoviesCount = 0;
                    
                    // Process MORE comments
                    for (let i = 0; i < Math.min(comments.length, 50); i++) {
                        const comment = comments[i];
                        
                        if (!comment || !comment.body || typeof comment.body !== 'string') {
                            continue;
                        }
                        
                        if (comment.body.length < 5) continue;
                        
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
                }
            }
            
            if (recommendations.size >= limit * 2) break; // Get more than needed
            
            await this.sleep(1500); // Slightly faster
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
        // More subreddits
        const subreddits = ['MovieSuggestions', 'ifyoulikeblank', 'movies', 'TrueFilm'];
        
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

                for (const post of resultsArray) {
                    const titleText = post?.title || '';
                    
                    if (!titleText.toLowerCase().includes(movieTitle.toLowerCase())) {
                        continue;
                    }
                    
                    if (post.num_comments > 0) {
                        try {
                            const submission = await this.reddit.getSubmission(post.id).fetch();
                            let comments = submission.comments || [];
                            
                            if (!Array.isArray(comments) && comments && typeof comments[Symbol.iterator] === 'function') {
                                comments = Array.from(comments);
                            }
                            
                            // Process MORE comments
                            for (let i = 0; i < Math.min(comments.length, 40); i++) {
                                const comment = comments[i];
                                if (!comment?.body || comment.body.length < 5) continue;
                                
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

                await this.sleep(1500);
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
        subredditsSet: new Set([context.subreddit]),
        sources: [context.source],
        redditUrls: [context.url],
      });
    } else {
      const existing = map.get(id);
      existing.mentions++;
      existing.totalConfidence += movie.confidence || 0;
      
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
    rec.subreddits = Array.from(rec.subredditsSet);
    delete rec.subredditsSet;
  }

  sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

module.exports = ImprovedRedditService;