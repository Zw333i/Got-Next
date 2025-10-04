// getRedditToken.js - Run this once to get your refresh token
const snoowrap = require('snoowrap');

async function getRefreshToken() {
    const r = new snoowrap({
        userAgent: 'Movie Recommendation Bot/1.0 by Candid_Effective2417',
        clientId: 'MStUTFTVaV3_NveBRshVWQ',
        clientSecret: '8b4-10sUoau_JPqRIzBYKYPx6oTvaA',
        username: 'Candid_Effective2417',
        password: 'walanakotiwala3!'
    });

    try {
        // Test the connection and get refresh token
        const me = await r.getMe();
        console.log('Successfully authenticated as:', me.name);
        console.log('Refresh Token:', r.refreshToken);
        
        // Save this refresh token to your .env file
        console.log('\nAdd these to your .env file:');
        console.log(`REDDIT_CLIENT_ID=${r.clientId}`);
        console.log(`REDDIT_CLIENT_SECRET=${r.clientSecret}`);
        console.log(`REDDIT_REFRESH_TOKEN=${r.refreshToken}`);
        
    } catch (error) {
        console.error('Authentication failed:', error.message);
    }
}

getRefreshToken();