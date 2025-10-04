// public/app.js
const API_BASE_URL = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
    ? 'http://localhost:5000/api' 
    : '/api';  

const movieInput = document.getElementById('movie-input');
const recommendBtn = document.getElementById('recommend-btn');
const resultsContainer = document.getElementById('results-container');
const recommendationSource = document.getElementById('recommendation-source');
const searchStats = document.getElementById('search-stats');
const exampleChips = document.querySelectorAll('.example-chip');
const searchSection = document.getElementById('search-section');
const modal = document.getElementById('movie-modal');
const modalClose = document.querySelector('.modal-close');

function createPopcorn() {
    const container = document.getElementById('popcorn-container');
    const popcorn = document.createElement('div');
    popcorn.className = 'popcorn';
    popcorn.style.left = Math.random() * 100 + '%';
    popcorn.style.animationDelay = Math.random() * 5 + 's';
    popcorn.style.animationDuration = (10 + Math.random() * 10) + 's';
    const shapes = ['50%', '40% 60%', '60% 40%'];
    popcorn.style.borderRadius = shapes[Math.floor(Math.random() * shapes.length)];
    container.appendChild(popcorn);
    setTimeout(() => {
        if (container.contains(popcorn)) container.removeChild(popcorn);
    }, 15000);
}

setInterval(createPopcorn, 2000);

// Event listeners
recommendBtn.addEventListener('click', getEnhancedRecommendations);
movieInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') getEnhancedRecommendations();
});

exampleChips.forEach(chip => {
    chip.addEventListener('click', () => {
        movieInput.value = chip.textContent;
        getEnhancedRecommendations();
    });
});

modalClose.addEventListener('click', closeModal);
window.addEventListener('click', (e) => {
    if (e.target === modal) closeModal();
});

async function getEnhancedRecommendations() {
    const query = movieInput.value.trim();
    if (!query) {
        showError('Enter movie title...');
        return;
    }
    
    showLoading('Finding your next cinematic masterpiece');
    clearPreviousResults();
    hideGlowLine();
    
    try {
        console.log(`🎬 Searching for: ${query}`);
        const searchResponse = await fetch(`${API_BASE_URL}/search?query=${encodeURIComponent(query)}`);
        
        if (!searchResponse.ok) throw new Error(`Search failed: ${searchResponse.status}`);
        
        const searchData = await searchResponse.json();
        
        if (!searchData.results || searchData.results.length === 0) {
            showError(`No matches found for "${query}". Try a different title.`);
            showGlowLine();
            return;
        }
        
        const firstResult = searchData.results[0];
        const movieType = firstResult.media_type === 'tv' || firstResult.name ? 'tv' : 'movie';
        const movieId = firstResult.id;
        const movieTitle = firstResult.title || firstResult.name;
        
        console.log(`🎭 Found: ${movieTitle} (${movieType}, ID: ${movieId})`);
        
        document.querySelector('.section-title').textContent = `What you Got Next after "${movieTitle}"`;
        
        // Get Reddit + TMDB recommendations
        const recommendResponse = await fetch(
            `${API_BASE_URL}/ai-recommendations/${movieType}/${movieId}?comprehensive=true`
        );
        
        if (!recommendResponse.ok) throw new Error(`Recommendations failed: ${recommendResponse.status}`);
        
        const recommendData = await recommendResponse.json();
        console.log('🍿 Recommendation data received:', recommendData);
        
        // PRIORITY: Use Reddit if available, otherwise TMDB
        if (recommendData.recommendations && recommendData.recommendations.length > 0) {
            const redditRecs = recommendData.recommendations.filter(r => r.source_type === 'reddit');
            const tmdbRecs = recommendData.recommendations.filter(r => r.source_type === 'tmdb');
            
            // Show ONLY Reddit if we have them, otherwise show TMDB
            const displayRecs = redditRecs.length > 0 ? redditRecs : tmdbRecs;
            
            displayEnhancedMovies(displayRecs);
            displaySourceInfo({
                ...recommendData,
                metadata: {
                    ...recommendData.metadata,
                    reddit_recommendations: redditRecs.length,
                    tmdb_recommendations: tmdbRecs.length,
                    has_reddit_data: redditRecs.length > 0
                }
            });
            
            if (recommendData.search_stats) {
                displaySearchStats(recommendData.search_stats, recommendData.metadata);
            }
        } else {
            showError(`No recommendations discovered for "${movieTitle}".`);
            showGlowLine();
        }
        
    } catch (error) {
        console.error('🚫 Error:', error);
        showError(`Unable to fetch recommendations: ${error.message}`);
        showGlowLine();
    }
}

function displayEnhancedMovies(movies) {
    resultsContainer.innerHTML = '';
    
    movies.forEach((movie, index) => {
        const movieCard = document.createElement('div');
        movieCard.className = 'movie-card';
        
        const posterPath = movie.poster_path 
            ? `https://image.tmdb.org/t/p/w500${movie.poster_path}`
            : 'https://via.placeholder.com/500x750/1c1c1c/888888?text=No+Poster';
        
        const title = movie.title || movie.name;
        const releaseDate = movie.release_date || movie.first_air_date;
        const year = releaseDate ? releaseDate.split('-')[0] : 'TBA';
        const rating = movie.vote_average ? movie.vote_average.toFixed(1) : 'N/A';
        const overview = movie.overview || 'A cinematic experience awaits discovery.';
        
        const isRedditRec = movie.source_type === 'reddit';
        const redditData = movie.reddit_data;
        
        let redditIndicator = isRedditRec ? '<div class="reddit-indicator">Community Pick</div>' : '';
        
        let redditDataHTML = '';
        if (isRedditRec && redditData && redditData.redditUrls && redditData.redditUrls.length > 0) {
            redditDataHTML = `
                <div class="reddit-data">
                    <a href="${redditData.redditUrls[0]}" target="_blank" rel="noopener" class="reddit-link">
                        📖 View Discussion →
                    </a>
                </div>
            `;
        }
        
        movieCard.innerHTML = `
            <div class="poster-container">
                <img src="${posterPath}" alt="${title}" class="movie-poster" loading="lazy">
                ${redditIndicator}
            </div>
            <div class="movie-info">
                <h3 class="movie-title">${title}</h3>
                <div class="movie-details">
                    <span class="rating">${rating}</span>
                    <span class="year">${year}</span>
                </div>
                <p class="movie-overview">${overview}</p>
                ${redditDataHTML}
            </div>
        `;
        
        // Click to open modal
        movieCard.addEventListener('click', () => openMovieModal(movie));
        
        movieCard.style.opacity = '0';
        movieCard.style.transform = 'translateY(50px)';
        
        setTimeout(() => {
            movieCard.style.transition = 'all 0.6s cubic-bezier(0.4, 0, 0.2, 1)';
            movieCard.style.opacity = '1';
            movieCard.style.transform = 'translateY(0)';
        }, index * 100);
        
        resultsContainer.appendChild(movieCard);
    });
}

async function openMovieModal(movie) {
    const movieType = movie.title ? 'movie' : 'tv';
    const movieId = movie.id;
    
    // Fetch detailed info
    try {
        const response = await fetch(`${API_BASE_URL}/details/${movieType}/${movieId}`);
        const details = await response.json();
        
        // Set backdrop and poster
        const backdropPath = details.backdrop_path 
            ? `https://image.tmdb.org/t/p/original${details.backdrop_path}`
            : `https://image.tmdb.org/t/p/w500${details.poster_path}`;
        const posterPath = details.poster_path 
            ? `https://image.tmdb.org/t/p/w500${details.poster_path}`
            : 'https://via.placeholder.com/500x750/1c1c1c/888888?text=No+Poster';
        
        document.getElementById('modal-backdrop').src = backdropPath;
        document.getElementById('modal-poster').src = posterPath;
        document.getElementById('modal-title').textContent = details.title || details.name;
        document.getElementById('modal-overview').textContent = details.overview || 'No overview available.';
        
        // Meta info
        const runtime = details.runtime ? `${details.runtime} min` : 'N/A';
        const releaseDate = details.release_date || details.first_air_date || 'N/A';
        const rating = details.vote_average ? details.vote_average.toFixed(1) : 'N/A';
        const genres = details.genres ? details.genres.map(g => g.name).join(', ') : 'N/A';
        
        document.getElementById('modal-meta').innerHTML = `
            <div class="modal-meta-item"><strong>⭐ Rating:</strong> ${rating}/10</div>
            <div class="modal-meta-item"><strong>📅 Released:</strong> ${releaseDate}</div>
            <div class="modal-meta-item"><strong>⏱️ Runtime:</strong> ${runtime}</div>
            <div class="modal-meta-item"><strong>🎭 Genres:</strong> ${genres}</div>
        `;
        
        // Streaming platforms (placeholder - would need JustWatch API)
        const streamingSection = document.getElementById('streaming-section');
        streamingSection.style.display = 'block';
        document.getElementById('streaming-platforms').innerHTML = `
            <p style="color: var(--text-muted); font-size: 0.95rem;">
                Streaming availability coming soon. Check JustWatch, Reelgood, or Google for current options.
            </p>
        `;
        
        // Reddit data
        const redditSection = document.getElementById('reddit-section');
        if (movie.source_type === 'reddit' && movie.reddit_data) {
            redditSection.style.display = 'block';
            const rd = movie.reddit_data;
            document.getElementById('modal-reddit-data').innerHTML = `
                <p style="color: var(--text-secondary); line-height: 1.8;">
                    This movie was recommended by the community with <strong>${rd.mentions || 1}</strong> mention(s) 
                    across <strong>${rd.subreddits ? rd.subreddits.length : 0}</strong> subreddit(s).
                </p>
                ${rd.redditUrls && rd.redditUrls.length > 0 ? `
                    <a href="${rd.redditUrls[0]}" target="_blank" rel="noopener" class="reddit-link" 
                       style="display: inline-block; margin-top: 15px; font-size: 1rem;">
                        📖 View Reddit Discussion →
                    </a>
                ` : ''}
            `;
        } else {
            redditSection.style.display = 'none';
        }
        
        modal.classList.add('active');
        document.body.style.overflow = 'hidden';
        
    } catch (error) {
        console.error('Error fetching movie details:', error);
        alert('Failed to load movie details');
    }
}

function closeModal() {
    modal.classList.remove('active');
    document.body.style.overflow = 'auto';
}

function displaySourceInfo(data) {
    const hasRedditData = data.metadata && data.metadata.has_reddit_data;
    const redditCount = data.metadata ? data.metadata.reddit_recommendations : 0;
    const tmdbCount = data.metadata ? data.metadata.tmdb_recommendations : 0;
    
    let badgeClass = 'source-tmdb';
    let badgeText = 'CINEMA DB';
    let sourceDescription = 'Database Recommendations';
    
    if (hasRedditData && redditCount > 0) {
        badgeClass = 'source-reddit';
        badgeText = 'COMMUNITY PICKS';
        sourceDescription = `${redditCount} recommendations from Reddit communities`;
    } else if (tmdbCount > 0) {
        badgeClass = 'source-tmdb';
        badgeText = 'DATABASE';
        sourceDescription = `${tmdbCount} recommendations from movie database`;
    }
    
    recommendationSource.innerHTML = `
        <div class="recommendation-source">
            <span>🎭 Source:</span>
            <span class="source-badge ${badgeClass}">${badgeText}</span>
            <span style="font-size: 0.9rem; color: var(--text-muted);">${sourceDescription}</span>
        </div>
    `;
}

function displaySearchStats(stats, metadata) {
    if (!stats || (!stats.processingTime && !stats.sourcesUsed.length)) {
        searchStats.innerHTML = '';
        return;
    }
    
    const processingTime = stats.processingTime ? (stats.processingTime / 1000).toFixed(1) : 'N/A';
    const uniqueMovies = stats.uniqueMovies || 0;
    const sources = stats.sourcesUsed || [];
    const totalRecs = metadata ? metadata.total_recommendations : 0;
    
    let statsHTML = `
        <div class="search-stats">
            <h4>🎬 Discovery Analytics</h4>
            <div class="stats-grid">
                <div class="stat-item">
                    <div class="stat-value">${processingTime}s</div>
                    <div class="stat-label">Search Time</div>
                </div>
                <div class="stat-item">
                    <div class="stat-value">${uniqueMovies}</div>
                    <div class="stat-label">Unique Titles</div>
                </div>
                <div class="stat-item">
                    <div class="stat-value">${sources.length}</div>
                    <div class="stat-label">Sources</div>
                </div>
                <div class="stat-item">
                    <div class="stat-value">${totalRecs}</div>
                    <div class="stat-label">Total Found</div>
                </div>
            </div>
    `;
    
    if (sources.length > 0) {
        statsHTML += `
            <div class="subreddit-sources">
                <strong>🗨️ Communities:</strong> ${sources.map(s => `r/${s}`).join(', ')}
            </div>
        `;
    }
    
    statsHTML += '</div>';
    searchStats.innerHTML = statsHTML;
}

function clearPreviousResults() {
    recommendationSource.innerHTML = '';
    searchStats.innerHTML = '';
}

function showLoading(message = 'Curating cinematic experiences') {
    resultsContainer.innerHTML = `
        <div class="loading">
            🎬 ${message}
            <span class="spinner"></span>
        </div>
    `;
}

function showError(message) {
    resultsContainer.innerHTML = `
        <div class="error-message">
            🎭 ${message}
        </div>
    `;
}

function hideGlowLine() {
    searchSection.classList.add('hide-glow');
}

function showGlowLine() {
    searchSection.classList.remove('hide-glow');
}

// Load popular content
async function loadPopularContent() {
    showLoading('Loading featured cinema');
    
    try {
        const response = await fetch(`${API_BASE_URL}/popular`);
        if (!response.ok) throw new Error(`Failed: ${response.status}`);
        
        const data = await response.json();
        let combined = [];
        if (data.movies) combined = combined.concat(data.movies.map(m => ({...m, source_type: 'tmdb'})));
        if (data.tv) combined = combined.concat(data.tv.map(m => ({...m, source_type: 'tmdb'})));
        
        if (combined.length === 0) {
            showError('No featured content available.');
            return;
        }
        
        combined.sort((a, b) => (b.vote_average || 0) - (a.vote_average || 0));
        const popular = combined.slice(0, 12);
        
        document.querySelector('.section-title').textContent = 'Featured Now';
        recommendationSource.innerHTML = `
            <div class="recommendation-source">
                <span>🎭 Showcasing:</span>
                <span class="source-badge source-tmdb">TRENDING</span>
                <span style="font-size: 0.9rem; color: var(--text-muted);">Popular movies and shows</span>
            </div>
        `;
        
        displayEnhancedMovies(popular);
    } catch (error) {
        console.error('Error loading popular:', error);
        showError('Unable to load featured content. Please refresh.');
    }
}

// Initialize
async function initializeApp() {
    console.log('🎬 Got Next - Cinema Discovery Platform');
    await loadPopularContent();
    for (let i = 0; i < 5; i++) {
        setTimeout(createPopcorn, i * 400);
    }
}

// Keyboard shortcuts
document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        movieInput.focus();
        movieInput.select();
    }
    if (e.key === 'Escape') {
        if (modal.classList.contains('active')) {
            closeModal();
        } else {
            movieInput.blur();
        }
    }
});

movieInput.addEventListener('focus', () => {
    document.querySelector('.input-wrapper').style.transform = 'scale(1.02)';
});

movieInput.addEventListener('blur', () => {
    document.querySelector('.input-wrapper').style.transform = 'scale(1)';
});

// Start app
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeApp);
} else {
    initializeApp();
}