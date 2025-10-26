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

  async extractTitlesFromMultipleComments(comments, originalTitle, contentType = 'movie') {
    if (!this.isAvailable() || !comments || comments.length === 0) {
      return null;
    }

    try {
      const yearMatch = originalTitle.match(/\s*\((\d{4})\)\s*$/);
      const titleOnly = originalTitle.replace(/\s*\(\d{4}\)\s*$/, '').trim();
      const year = yearMatch ? yearMatch[1] : null;

      const titleContext = year ? `"${titleOnly}" (${year})` : `"${titleOnly}"`;
      
      const combinedText = comments
        .map((comment, idx) => `--- Comment ${idx + 1} ---\n${comment.substring(0, 500)}`)
        .join('\n\n');

      const prompt = `You are helping find movie recommendations for someone who wants to watch movies SIMILAR to ${titleContext}.

Multiple Reddit Comments:
"""
${combinedText.substring(0, 3000)}
"""

CRITICAL RULES:
1. EXTRACT movie titles recommended as SIMILAR/ALTERNATIVE to "${titleOnly}"
2. Look across ALL comments provided above
3. ONLY extract unique movie titles (no duplicates)
4. Include year if mentioned: "Title (year)"
5. Return ONE title per line, maximum 15 titles
6. NO explanations, numbering, bullets, or markdown
7. If NO recommendations found, return NOTHING

Extract movie recommendations now:`;

      const completion = await this.groq.chat.completions.create({
        messages: [{ role: 'user', content: prompt }],
        model: 'llama-3.1-8b-instant',
        temperature: 0.1,
        max_tokens: 600,
      });

      const response = completion.choices[0]?.message?.content?.trim();

      if (!response || response.length < 3) {
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
        .slice(0, 15);

      console.log(`  🤖 AI batch extracted ${titles.length} titles from ${comments.length} comments`);
      return titles.length > 0 ? titles : null;

    } catch (error) {
      console.error('  ⚠️ AI batch parsing error:', error.message);
      return null;
    }
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

Reddit Comment/Post:
"""
${text.substring(0, 2000)}
"""

CRITICAL RULES:
1. EXTRACT movie titles that are recommended as SIMILAR/ALTERNATIVE to "${titleOnly}"
2. The text CAN be:
   - A list of recommendations FOR "${titleOnly}" 
   - Someone saying they watched "${titleOnly}" and want more
   - Someone asking for movies BESIDES/OTHER THAN "${titleOnly}"
   - Someone discussing non-linear movies and mentioning "${titleOnly}" as an example

3. IGNORE if:
   - The text is asking about a COMPLETELY DIFFERENT movie (not mentioning "${titleOnly}" at all)
   - Titles mentioned as what NOT to watch
   - Comparisons saying movies are "unlike ${titleOnly}"

4. EXTRACT if you see:
   - "movies like ${titleOnly}"
   - "similar to ${titleOnly}"
   - "if you liked ${titleOnly}, watch..."
   - "just watched ${titleOnly}" + recommendation keywords (want more, need more, etc.)
   - "besides ${titleOnly}" / "other than ${titleOnly}" (these are asking for alternatives)
   - Discussion about movie type/genre with "${titleOnly}" as example (extract OTHER movies mentioned)

5. Format: Include year if mentioned: "Title (year)"
6. Return ONE title per line, maximum 10 titles
7. NO explanations, numbering, bullets, or markdown

Examples:

INPUT: "Just watched Weapons (2025) at the talkies and I want more!!"
OUTPUT: (extract recommendations from comments/body)

INPUT: "Name some good modern non-linear movies besides Weapons (2025)"
OUTPUT: (extract OTHER non-linear movies mentioned - these are alternatives to Weapons)

INPUT: "Movies like Inception?"
OUTPUT: (if this text is about Inception, extract recommendations. If we're searching for "${titleOnly}" but text is about Inception, return NOTHING)

If the text doesn't mention "${titleOnly}" at all, return NOTHING.
If NO recommendations exist, return NOTHING.`;

      const completion = await this.groq.chat.completions.create({
        messages: [{ role: 'user', content: prompt }],
        model: 'llama-3.1-8b-instant',
        temperature: 0.1,
        max_tokens: 500,
      });

const response = completion.choices[0]?.message?.content?.trim();

if (!response) return null;

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