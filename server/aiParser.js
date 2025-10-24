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
const yearMatch = originalTitle.match(/\s*\((\d{4})\)\s*$/);
const titleOnly = originalTitle.replace(/\s*\(\d{4}\)\s*$/, '').trim();
const year = yearMatch ? yearMatch[1] : null;

const titleContext = year 
    ? `"${titleOnly}" (${year})` 
    : `"${titleOnly}"`;

const prompt = `You are helping find movie recommendations for someone who wants to watch movies SIMILAR to ${titleContext}.

Reddit Comment:
"""
${text.substring(0, 2000)}
"""

CRITICAL RULES:
1. ONLY extract movie titles if they are recommended as SIMILAR/ALTERNATIVE to "${titleOnly}"
2. The comment MUST be discussing ${titleContext} as the main subject
3. If the comment is asking about a DIFFERENT movie (not ${titleContext}), return: "WRONG MOVIE - comment is about [other movie name]"
4. IGNORE titles mentioned as:
   - Other options the user is considering ("I'm deciding between X or Y")
   - Comparisons to different movies ("unlike ${titleOnly}")
   - Examples of different genres
   - The person's favorite movies (unless they say these are similar to ${titleOnly})

5. ONLY extract if you see phrases like:
   - "movies like ${titleOnly}"
   - "similar to ${titleOnly}"
   - "if you liked ${titleOnly}, watch..."
   - "reminds me of ${titleOnly}"
   - "${titleOnly} fans should watch..."

6. Format: Include year if mentioned: "Title (year)"
7. Return ONE title per line, maximum 8 titles
8. NO explanations, numbering, or bullets

Example BAD comment (should return NOTHING):
"I want to watch The Naked Gun. Should I also consider Weapons or Nobody 2?"
→ This is asking about The Naked Gun, NOT giving recommendations for it.

Example GOOD comment (extract the titles):
"If you liked The Naked Gun, you should watch Airplane! and The Other Guys."
→ These are recommendations FOR The Naked Gun.

If NO recommendations exist for "${titleOnly}", return NOTHING.`;

      const completion = await this.groq.chat.completions.create({
        messages: [{ role: 'user', content: prompt }],
        model: 'llama-3.1-8b-instant',
        temperature: 0.1,
        max_tokens: 500,
      });

const response = completion.choices[0]?.message?.content?.trim();

if (!response) return null;

// Check if AI detected wrong movie context
if (response.toLowerCase().includes('wrong movie')) {
    console.log(`  🚫 AI detected: Comment is about a DIFFERENT movie, not "${originalTitle}"`);
    return null;
}

      if (response.toLowerCase().includes('no recommendations') || 
          response.toLowerCase().includes('no similar') ||
          response.length < 3) {
          console.log(`  ℹ️ AI found no recommendations for "${originalTitle}"`);
          return null;
      }

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

      console.log(`  🤖 AI extracted ${titles.length} titles for "${originalTitle}"`);
      return titles.length > 0 ? titles : null;

    } catch (error) {
      console.error('  ⚠️ AI parsing error:', error.message);
      return null; 
    }
  }
}

module.exports = AIParser;