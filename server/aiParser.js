// server/aiParser.js
const Groq = require('groq-sdk');

class AIParser {
  constructor() {
    const apiKey = process.env.GROQ_API_KEY;
    
    if (!apiKey) {
      console.warn('⚠️ GROQ_API_KEY not found - AI parsing disabled');
      this.groq = null;
      return;
    }

    this.groq = new Groq({ apiKey });
    console.log('✅ Groq AI parser initialized');
  }

  isAvailable() {
    return this.groq !== null;
  }

  async extractTitles(text, originalTitle, contentType = 'movie') {
    if (!this.isAvailable()) {
      return null; 
    }

    try {
const prompt = `You are a movie/TV show recommendation parser. Extract ONLY titles that are SIMILAR TO and RECOMMENDED INSTEAD OF "${originalTitle}".

Original ${contentType}: "${originalTitle}"

Reddit Comment:
"""
${text.substring(0, 2000)}
"""

CRITICAL RULES:
1. ONLY extract titles that are being recommended as SIMILAR or ALTERNATIVE to "${originalTitle}"
2. SKIP titles mentioned in DIFFERENT contexts (e.g., "unlike", "not like", "different genre", "opposite of")
3. SKIP titles from DIFFERENT GENRES unless explicitly recommended as similar
4. If a title is mentioned but NOT recommended as similar to "${originalTitle}", DO NOT extract it
5. Include the year in parentheses if mentioned: "Title (2020)"
6. Return ONE title per line
7. NO explanations, NO numbering, NO bullets
8. Maximum 8 titles only

GOOD examples (extract these):
- "If you liked ${originalTitle}, try The Hangover"
- "Similar to ${originalTitle}: Road Trip"
- "${originalTitle} fans should watch EuroTrip"

BAD examples (DO NOT extract these):
- "Unlike ${originalTitle}, Rear Window is a thriller" (different genre comparison)
- "Psycho is nothing like ${originalTitle}" (negative comparison)
- "I also like Vertigo" (mentioned but not as recommendation for ${originalTitle})
- "Hitchcock films like Rear Window are classics" (random mention)

If the comment does NOT contain similar recommendations for "${originalTitle}", return nothing.
`;

      const completion = await this.groq.chat.completions.create({
        messages: [{ role: 'user', content: prompt }],
        model: 'llama-3.1-8b-instant', // Fast and free
        temperature: 0.1,
        max_tokens: 500,
      });

      const response = completion.choices[0]?.message?.content?.trim();
      
      if (!response) return null;

      const titles = response
        .split('\n')
        .map(line => line.trim())
        .filter(line => line.length > 0)
        .filter(line => {
          const cleaned = line.replace(/^[\d\.\)\-\*•]\s*/, '').trim();
          return cleaned.length >= 2 && /[A-Za-z]/.test(cleaned);
        })
        .map(line => line.replace(/^[\d\.\)\-\*•]\s*/, '').trim())
        .slice(0, 10);

      console.log(`  🤖 AI extracted ${titles.length} titles`);
      return titles.length > 0 ? titles : null;

    } catch (error) {
      console.error('  ⚠️ AI parsing error:', error.message);
      return null; 
    }
  }
}

module.exports = AIParser;