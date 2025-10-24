// server/redditServiceV2.js - Optimized for maximum movie extraction
const snoowrap = require('snoowrap');
const axios = require('axios');
const AIParser = require('./aiParser');

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
    this.aiParser = new AIParser();
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
  

  

  async searchAndValidateTMDB(title, year = null, contentType = 'movie') {
    if (!title) return [];
    const cacheKey = year ? `tmdb_${contentType}_${title.toLowerCase()}_${year}` : `tmdb_${contentType}_${title.toLowerCase()}`;

    return this.getCached(cacheKey, async () => {
      try {
        const params = { 
          api_key: this.tmdbApiKey, 
          query: title, 
          include_adult: false 
        };
        
        if (year) {
          params.year = year;
          params.primary_release_year = year;
        }
        
        const endpoint = contentType === 'tv' ? '/search/tv' : '/search/movie';
        const response = await axios.get(`${this.tmdbBaseUrl}${endpoint}`, {
          headers: { Authorization: `Bearer ${this.tmdbAccessToken}` },
          params: params,
          timeout: 10000,
        });

        let results = (response.data.results || [])
          .filter((m) => {
          const hasTitle = contentType === 'tv' ? m.name : m.title;
          return m && hasTitle && m.poster_path && m.vote_average > 0;
        });
        
        if (year && results.length > 0) {
          const exactYearMatch = results.find(m => {
            const releaseYear = m.release_date ? m.release_date.split('-')[0] : null;
            return releaseYear === year;
          });
          
          if (exactYearMatch) {
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

  async extractRecommendationsFromPost(text, originalTitle, contentType = 'movie') {
  if (!text || typeof text !== 'string') return [];

  if (this.aiParser && this.aiParser.isAvailable()) {
    const aiTitles = await this.aiParser.extractTitles(text, originalTitle, contentType);
    
    if (aiTitles && aiTitles.length > 0) {
      console.log(`  🤖 Using AI-extracted titles (${aiTitles.length} found)`);
      
      const validated = [];
      for (const titleStr of aiTitles) {
        const yearMatch = /\((\d{4})\)/.exec(titleStr);
        const title = titleStr.replace(/\s*\(\d{4}\)\s*/, '').trim();
        const year = yearMatch ? yearMatch[1] : null;
        
        try {
          const tmdbResults = await this.searchAndValidateTMDB(title, year, contentType);
          if (tmdbResults.length > 0) {
            const matchedMovie = tmdbResults[0];
            const movieYear = matchedMovie.release_date 
              ? matchedMovie.release_date.split('-')[0] 
              : matchedMovie.first_air_date 
                ? matchedMovie.first_air_date.split('-')[0] 
                : 'Unknown';
            console.log(`  ✅ "${title}"${year ? ` (${year})` : ''} → "${matchedMovie.title || matchedMovie.name}" (${movieYear})`);
            validated.push({
              extractedTitle: title,
              tmdbMatch: matchedMovie,
              confidence: this.calculateMatchConfidence(title, matchedMovie.title || matchedMovie.name),
            });
          }
        } catch (error) {
          console.log(`  ⚠️ Error for "${title}": ${error.message}`);
        }
        
        await this.sleep(100);
      }
      
      if (validated.length > 0) {
        console.log(`  ✅ ${validated.length} AI recommendations validated`);
        return validated;
      }
    }
  }

  console.log('  📝 Using regex extraction (AI unavailable or failed)');
  const potentialTitles = new Set();
    const lines = text.split('\n');
    
    const titlesWithYears = new Map(); 
    
    lines.forEach(line => {
        const trimmed = line.trim();
        
        const lineWithYear = /^([A-Z][A-Za-z0-9\s&:'.!?-]{2,49})\s*\((\d{4})\)$/.exec(trimmed);
        if (lineWithYear) {
            const title = lineWithYear[1].trim();
            const year = lineWithYear[2];
            potentialTitles.add(title);
            titlesWithYears.set(title, year); 
        } else if (/^[A-Z][A-Za-z0-9\s&:'.!?-]{2,49}$/.test(trimmed)) {
 
            potentialTitles.add(trimmed);
        }
    });
    
    const bulletPattern = /^[\s]*[-*•]\s*([A-Z][A-Za-z0-9\s&:'.!?-]{2,49})/gm;
    let match;
    while ((match = bulletPattern.exec(text)) !== null) {
        potentialTitles.add(match[1].trim());
    }
    
    const numberedPattern = /^\d+[\.\)]\s*([A-Z][A-Za-z0-9\s&:'.!?-]{2,49})/gm;
    while ((match = numberedPattern.exec(text)) !== null) {
        potentialTitles.add(match[1].trim());
    }
    
    const boldPattern = /\*\*([A-Z][A-Za-z0-9\s&:'.!?-]{2,50})\*\*/g;
    while ((match = boldPattern.exec(text)) !== null) {
        potentialTitles.add(match[1].trim());
    }
    
    const yearPattern = /([A-Z][A-Za-z0-9\s&:'.!?-]{2,50})\s*\((\d{4})\)/g;
    while ((match = yearPattern.exec(text)) !== null) {
        const title = match[1].trim();
        const year = match[2];
        potentialTitles.add(title);
        titlesWithYears.set(title, year);
    }
    
    const quotedPattern = /"([A-Z][A-Za-z0-9\s&:'.!?-]{2,50})"/g;
    while ((match = quotedPattern.exec(text)) !== null) {
        potentialTitles.add(match[1].trim());
    }
    
    const actionPattern = /(?:watch|try|recommend|check out|see|loved)\s+([A-Z][A-Za-z0-9\s&:'.!?-]{3,40})/gi;
    while ((match = actionPattern.exec(text)) !== null) {
        potentialTitles.add(match[1].trim());
    }

    console.log(`  📝 Extracted ${potentialTitles.size} potential titles`);

    const filtered = Array.from(potentialTitles).filter((t) => {
      const lower = t.toLowerCase();
      const orig = originalTitle.toLowerCase();
      
      if (lower === orig || lower.includes(orig) || orig.includes(lower)) return false;
      
      const cleaned = t.replace(/\s*\([^)]*\)\s*/g, '').trim();
      if (cleaned.length < 2) return false;
      
      const skipPhrases = [
        'reddit', 'edit', 'thanks', 'update', 'thread', 'subreddit',
        'the movie', 'the film', 'this movie', 'that movie',
        'any movie', 'some movie', 'something like'
      ];
      
      if (skipPhrases.some(phrase => lower === phrase)) return false;
      
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
      
      return /[A-Za-z]{2,}/.test(t);
    });

    console.log(`  🔍 ${filtered.length} titles after filtering`);

    const validated = [];
    const batchSize = 5;
    
    const titlesToProcess = filtered.slice(0, 20);

    for (let i = 0; i < titlesToProcess.length; i += batchSize) {
        const batch = titlesToProcess.slice(i, i + batchSize);
        
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

calculatePostRelevance(postTitle, searchMovieTitle, releaseYear = null) {
  const titleLower = postTitle.toLowerCase();
  
  const movieTitleOnly = searchMovieTitle.replace(/\s*\(\d{4}\)\s*$/, '').trim();
  const queryLower = movieTitleOnly.toLowerCase();
  
  let score = 0;
  
  if (titleLower.includes(`"${queryLower}"`) && 
      (titleLower.includes('like') || titleLower.includes('similar') || titleLower.includes('recommend'))) {
    score += 200;
  }
  
  if (releaseYear) {
    const hasYear = titleLower.includes(releaseYear);
    const hasTitle = titleLower.includes(queryLower);
    const hasContext = titleLower.includes('like') || titleLower.includes('similar') || titleLower.includes('recommend');
    
    if (hasYear && hasTitle && hasContext) {
      score += 150;
    } else if (hasYear && hasTitle) {
      score += 20;
    }
  }
  
  if (titleLower.includes(queryLower)) {
    if (titleLower.includes('if you liked ' + queryLower)) score += 100;
    if (titleLower.includes('similar to ' + queryLower)) score += 90;
    if (titleLower.includes('movies like ' + queryLower)) score += 85;
    if (titleLower.includes(queryLower + ' recommendations')) score += 80;
    
    if (titleLower.includes('like')) score += 30;
    if (titleLower.includes('recommend')) score += 25;
    if (titleLower.includes('suggestions')) score += 20;
  } else {
    return -1000;
  }
  
  const killPatterns = [
    `best.*movies with`,
    `movies with.*${queryLower}`,
    `films with.*${queryLower}`,
    `featuring.*${queryLower}`,
    `${queryLower}.*scenes?`,
    `${queryLower}.*moments?`,
    `great.*${queryLower}.*movies`,
    `${queryLower}.*in.*movies`,
  ];
  
  for (const pattern of killPatterns) {
    if (new RegExp(pattern, 'i').test(titleLower)) {
      return -1000; 
    }
  }
  
  const badKeywords = ['unlike', 'opposite', 'different from', 'not as good', 'nothing like', 'not like'];
  badKeywords.forEach(keyword => {
    if (titleLower.includes(keyword)) score -= 500;
  });
  
  return score;
}

async getQuickRecommendations(movieTitle, limit = 32, contentType = 'movie') {
    if (!this.isAvailable()) return [];

    try {
        console.log(`🔍 Searching for ${contentType === 'tv' ? 'TV shows' : 'movies'} like: ${movieTitle}`);
        const recommendations = new Map();
        
        // Get original movie's genres and year for better filtering
        let originalGenres = null;
        let releaseYear = null;
        try {
            const searchResults = await this.searchAndValidateTMDB(movieTitle, null, contentType);
            if (searchResults.length > 0) {
                originalGenres = await this.getMovieGenres(searchResults[0].id, contentType);
                const releaseDate = searchResults[0].release_date || searchResults[0].first_air_date;
                releaseYear = releaseDate ? releaseDate.split('-')[0] : null;
                console.log(`📋 Original: ${searchResults[0].title || searchResults[0].name} (${releaseYear})`);
                console.log(`📋 Genres: ${originalGenres.map(g => g.name).join(', ')}`);
            }
        } catch (e) {
            console.log('⚠️ Could not fetch original movie details');
        }
        
        const movieTitleClean = movieTitle.replace(/\s*\(\d{4}\)\s*$/, '').trim();
        
        let query;
        if (contentType === 'tv') {
            query = releaseYear 
                ? `(title:"like ${movieTitleClean}" OR title:"similar to ${movieTitleClean}" OR title:"${movieTitleClean} recommendations" OR title:"if you liked ${movieTitleClean}") ${releaseYear}`
                : `(title:"like ${movieTitleClean}" OR title:"similar to ${movieTitleClean}" OR title:"${movieTitleClean} recommendations" OR title:"if you liked ${movieTitleClean}")`;
        } else {
            query = releaseYear 
                ? `(title:"movies like ${movieTitleClean}" OR title:"similar to ${movieTitleClean}" OR title:"${movieTitleClean} recommendations" OR title:"if you liked ${movieTitleClean}") ${releaseYear}`
                : `(title:"movies like ${movieTitleClean}" OR title:"similar to ${movieTitleClean}" OR title:"${movieTitleClean} recommendations" OR title:"if you liked ${movieTitleClean}")`;
        }

        console.log(`🔍 Search query: "${query}"`);

        console.log(`🔍 Search query: "${query}"`);
        
        const subreddit = contentType === 'tv' ? 'televisionsuggestions' : 'MovieSuggestions';
        console.log(`📺 Searching r/${subreddit} for ${contentType}`);
        
        let results;
        try {
            results = await this.reddit
                .getSubreddit(subreddit)
                .search({
                    query: query,
                    sort: 'relevance',
                    time: 'all',
                    limit: 20
                });
        } catch (searchError) {
            console.error(`❌ Failed to search r/${subreddit}:`, searchError.message);
            if (contentType === 'tv') {
                console.log(`🔄 Trying alternative: r/television`);
                try {
                    results = await this.reddit
                        .getSubreddit('television')
                        .search({
                            query: query,
                            sort: 'relevance',
                            time: 'all',
                            limit: 20
                        });
                } catch (altError) {
                    console.error(`❌ Alternative search also failed:`, altError.message);
                    return [];
                }
            } else {
                return [];
            }
        }
        
        const resultsArray = Array.isArray(results) ? results : Array.from(results || []);
        console.log(`📊 Found ${resultsArray.length} posts`);
        
        const batchSize = 3;
        let shouldStop = false;
        
for (let i = 0; i < Math.min(resultsArray.length, 8); i += batchSize) {
    if (shouldStop || recommendations.size >= limit) {
        console.log(`✅ Reached ${recommendations.size} recommendations - stopping search`);
        break;
    }
    
    const batch = resultsArray.slice(i, i + batchSize);
    
    // Sort batch by relevance score
    const scoredBatch = batch.map(post => ({
        post,
        relevance: this.calculatePostRelevance(post?.title || '', movieTitle, releaseYear)
    })).filter(item => item.relevance > 0)
        .sort((a, b) => b.relevance - a.relevance);

    await Promise.all(scoredBatch.map(async ({ post, relevance }) => {
        if (recommendations.size >= limit) {
            return;
        }
        
        const titleText = post?.title || '';
        console.log(`\n🔍 Checking post: "${titleText}" (relevance: ${relevance})`);
      
const titleLower = titleText.toLowerCase();
const movieTitleOnly = searchMovieTitle.replace(/\s*\(\d{4}\)\s*$/, '').trim();
const queryLower = movieTitleOnly.toLowerCase();

console.log(`\n   🎯 Checking post: "${titleText}"`);
console.log(`   🔍 Looking for: "${movieTitleOnly}"`);

// CRITICAL: Post MUST be asking for recommendations FOR this specific movie
// NOT just mentioning it as an example

// Pattern 1: "movies like [OUR MOVIE]" or "films like [OUR MOVIE]"
const patternMoviesLike = new RegExp(`(movies?|films?|shows?)\\s+like\\s+["']?${queryLower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["']?`, 'i');

// Pattern 2: "similar to [OUR MOVIE]"
const patternSimilarTo = new RegExp(`similar\\s+to\\s+["']?${queryLower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["']?`, 'i');

// Pattern 3: "[OUR MOVIE] recommendations"
const patternRecommendations = new RegExp(`["']?${queryLower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["']?\\s+(recommendation|suggest)`, 'i');

// Pattern 4: "if you liked [OUR MOVIE]"
const patternIfYouLiked = new RegExp(`if\\s+you\\s+(liked?|loved?)\\s+["']?${queryLower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["']?`, 'i');

// Pattern 5: "[OUR MOVIE]" in title with recommendation context nearby
const hasMovieInQuotes = titleText.includes(`"${movieTitleOnly}"`) || titleText.includes(`'${movieTitleOnly}'`);
const hasRecContext = /like|similar|recommend|suggest|if you/i.test(titleText);

const isValidPost = 
    patternMoviesLike.test(titleText) ||
    patternSimilarTo.test(titleText) ||
    patternRecommendations.test(titleText) ||
    patternIfYouLiked.test(titleText) ||
    (hasMovieInQuotes && hasRecContext);

if (!isValidPost) {
    console.log(`   🚫 REJECTED: Not asking for "${movieTitleOnly}" recommendations`);
    console.log(`   ❌ Post appears to be asking about something else`);
    return;
}

// ANTI-PATTERN: Reject if movie is mentioned as one of MANY examples
// Example: "movies with fight scenes, like John Wick, Extraction, Equalizer"
const moviePosition = titleText.toLowerCase().indexOf(queryLower);
if (moviePosition !== -1) {
    const textAfterMovie = titleText.substring(moviePosition + queryLower.length, moviePosition + queryLower.length + 50);
    const hasOtherMoviesAfter = /,\s*[A-Z][a-z]+|and\s+[A-Z][a-z]+|\s+or\s+[A-Z][a-z]+/.test(textAfterMovie);
    
    if (hasOtherMoviesAfter && !patternMoviesLike.test(titleText.substring(0, moviePosition + queryLower.length))) {
        console.log(`   🚫 REJECTED: "${movieTitleOnly}" is just one of many examples`);
        console.log(`   ❌ Post is asking for a different type of movie`);
        return;
    }
}

// ANTI-PATTERN: Reject posts asking about fight scenes, special effects, etc.
const askingForAttribute = /(movies?|films?)\s+(with|that have|featuring)\s+(good|great|amazing|intense)/i.test(titleText);
if (askingForAttribute && !patternMoviesLike.test(titleText)) {
    console.log(`   🚫 REJECTED: Post is asking for movies with specific attributes`);
    console.log(`   ❌ Not asking for movies similar to "${movieTitleOnly}"`);
    return;
}

console.log(`   ✅ VALID: Post is asking for "${movieTitleOnly}" recommendations`);
                
                if (post.num_comments > 0) {
                    try {
                        const submission = await this.reddit.getSubmission(post.id).fetch();
                        let comments = submission.comments || [];
                        
                        if (!Array.isArray(comments)) {
                            if (comments && typeof comments[Symbol.iterator] === 'function') {
                                comments = Array.from(comments);
                            } else {
                                return;
                            }
                        }
                        
                        const topComments = comments
                            .filter(c => c && c.body && c.body.length >= 5)
                            .sort((a, b) => (b.score || 0) - (a.score || 0))
                            .slice(0, 15);
                        
                        console.log(`   Processing ${topComments.length} top comments...`);
                        
                        const commentBatchSize = 5;
                        for (let j = 0; j < topComments.length; j += commentBatchSize) {
                            if (recommendations.size >= limit) {
                                console.log(`   ⏸️ Stopping comment processing - found enough results (${recommendations.size}/${limit})`);
                                shouldStop = true;
                                break;
                            }
                            
                            const commentBatch = topComments.slice(j, j + commentBatchSize);
                            
                            const batchResults = await Promise.all(
                                commentBatch.map(async (comment) => {
                                    return await this.extractRecommendationsFromPost(
                                        comment.body,
                                        movieTitle,
                                        contentType
                                    );
                                })
                            );
                            
                            for (let idx = 0; idx < batchResults.length; idx++) {
                                if (shouldStop) break;
                                
                                const commentMovies = batchResults[idx];
                                const comment = commentBatch[idx];

                                    if (!commentMovies || commentMovies.length === 0) {
                                      continue;
                                  }

                                  console.log(`   📝 Comment found ${commentMovies.length} potential recommendation(s)`);
                                
                                for (const movie of commentMovies) {
                                    if (recommendations.size >= limit) {
                                        console.log(`   🛑 Hard stop - reached ${limit} recommendations`);
                                        shouldStop = true;
                                        break;
                                    }
                                    
                                    if (!movie?.tmdbMatch) continue;
                                    
                                    // Genre filtering
                                    if (originalGenres && originalGenres.length > 0) {
                                        try {
                                            const movieGenres = await this.getMovieGenres(movie.tmdbMatch.id, contentType);
                                            if (!this.isGenreSimilar(originalGenres, movieGenres)) {
                                                console.log(`  ⏭️ Skipping "${movie.tmdbMatch.title || movie.tmdbMatch.name}" - genre mismatch`);
                                                continue;
                                            }
                                        } catch (e) {
                                            console.log(`  ⚠️ Genre check failed for "${movie.tmdbMatch.title}"`);
                                        }
                                    }
                                    
                                    this.addOrUpdateRecommendation(recommendations, movie, {
                                        source: 'comment',
                                        subreddit: subreddit,
                                        score: comment.score || 1,
                                        url: post?.permalink ? `https://reddit.com${post.permalink}` : '#',
                                    });
                                }
                                
                                if (shouldStop) break;
                            }
                            
                            if (shouldStop) break;
                        }
                    } catch (commentError) {
                        console.log('   ⚠️ Could not fetch comments:', commentError.message);
                    }
                }
            }));

            if (shouldStop || recommendations.size >= limit) {
                console.log(`   ⏸️ Stopping - found ${recommendations.size} recommendations`);
                break;
            }
            
            if (recommendations.size >= limit) {
                console.log(`✅ Found ${recommendations.size} recommendations - stopping early`);
                break;
            }
            
            await this.sleep(800);
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

  async getRecommendations(movieTitle, limit = 32, contentType = 'movie') {
    if (!this.isAvailable()) return [];

    const cacheKey = `reddit_recs_${movieTitle.toLowerCase()}`;
    return this.getCached(cacheKey, async () => {
        const recommendations = new Map();

        const subreddits = contentType === 'tv' 
        ? ['televisionsuggestions', 'ifyoulikeblank', 'tv_shows']
        : ['MovieSuggestions', 'ifyoulikeblank', 'movies'];
        
        for (const subreddit of subreddits) {
            const searchTerm = contentType === 'tv' ? 'tv shows' : 'movies';
            const query = `${searchTerm} like ${movieTitle}`;
            
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
                // Stop if we have enough recommendations
                if (recommendations.size >= limit) {
                    console.log(`✅ Reached ${recommendations.size} recommendations in r/${subreddit} - moving to next subreddit`);
                    break;
                }
                
                const titleText = post?.title || '';
                    
                    if (post.num_comments > 0) {
                        try {
                            const submission = await this.reddit.getSubmission(post.id).fetch();
                            let comments = submission.comments || [];
                            
                            if (!Array.isArray(comments) && comments && typeof comments[Symbol.iterator] === 'function') {
                                comments = Array.from(comments);
                            }
                            
                            for (let i = 0; i < Math.min(comments.length, 40); i++) {
                                const comment = comments[i];
                                if (!comment?.body || comment.body.length < 5) continue;
                                
                                const movies = await this.extractRecommendationsFromPost(comment.body, movieTitle, contentType);
                                
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

          const stoppedEarly = recommendations.size >= limit;
          console.log(`\n✅ Final: ${finalResults.length} unique recommendations${stoppedEarly ? ' (stopped early - found enough results)' : ''}`);
          return finalResults;
    });
  }

  async getMovieGenres(movieId, contentType = 'movie') {
  try {
    const endpoint = contentType === 'tv' ? `/tv/${movieId}` : `/movie/${movieId}`;
    const response = await axios.get(`${this.tmdbBaseUrl}${endpoint}`, {
      headers: { Authorization: `Bearer ${this.tmdbAccessToken}` },
      params: { api_key: this.tmdbApiKey },
      timeout: 5000,
    });
    return response.data.genres || [];
  } catch (error) {
    return [];
  }
}

isGenreSimilar(genres1, genres2) {
  if (!genres1 || !genres2 || genres1.length === 0 || genres2.length === 0) {
    return true; // If we can't determine, allow it
  }
  
  const ids1 = genres1.map(g => g.id);
  const ids2 = genres2.map(g => g.id);
  
  // Check if at least 1 genre matches
  return ids1.some(id => ids2.includes(id));
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