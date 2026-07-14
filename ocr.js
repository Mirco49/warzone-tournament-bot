const Tesseract = require('tesseract.js');
const sharp = require('sharp');

function getPlacementMultiplier(placement) {
  if (placement === 1) return 1.6;
  if (placement >= 2 && placement <= 5) return 1.4;
  if (placement >= 6 && placement <= 10) return 1.2;
  return 1.0;
}

function calculatePoints(kills, placement) {
  const totalKills = kills || 0;
  const multiplier = getPlacementMultiplier(placement);
  const points = totalKills * multiplier;
  return Math.round(points * 10) / 10;
}

async function preprocessImage(imageBuffer) {
  try {
    const processed = await sharp(imageBuffer)
      .grayscale()
      .normalize()
      .sharpen({ sigma: 1, flat: 1, jagged: 2 })
      .toBuffer();
    return processed;
  } catch (error) {
    console.error('Errore preprocessamento:', error);
    return imageBuffer;
  }
}

async function extractWarzoneData(imageUrl) {
  try {
    const response = await fetch(imageUrl);
    const imageBuffer = Buffer.from(await response.arrayBuffer());
    const processedBuffer = await preprocessImage(imageBuffer);

    const result = await Tesseract.recognize(
      processedBuffer,
      'eng+ita',
      { logger: m => console.log(m.status, Math.round(m.progress * 100) + '%') }
    );

    const text = result.data.text.toLowerCase();
    console.log('Testo estratto:', text);

    const data = {
      kills: null,
      placement: null,
      confidence: result.data.confidence
    };

    // Pattern KILLS
    const killPatterns = [
      /(\d+)\s*kills?/i,
      /kills?\s*[:=]?\s*(\d+)/i,
      /(\d+)\s*eliminations?/i,
      /eliminations?\s*[:=]?\s*(\d+)/i,
      /(\d+)\s*elims?/i,
      /elims?\s*[:=]?\s*(\d+)/i,
      /total\s*kills?\s*[:=]?\s*(\d+)/i,
      /squad\s*kills?\s*[:=]?\s*(\d+)/i,
      /team\s*kills?\s*[:=]?\s*(\d+)/i,
      /(\d+)\s*players?\s*eliminated/i,
      /kills?[.\s]*\n[.\s]*(\d+)/i,
      /(\d+)[.\s]*kills?/i,
      /(\d+)[.\s]*elim/i
    ];

    for (const pattern of killPatterns) {
      const match = text.match(pattern);
      if (match) {
        data.kills = parseInt(match[1]);
        break;
      }
    }

    // Pattern PLACEMENT
    const placementPatterns = [
      /#?(\d+)(?:st|nd|rd|th)?\s*place/i,
      /placement\s*[:=]?\s*#?(\d+)/i,
      /posizione\s*[:=]?\s*#?(\d+)/i,
      /classifica\s*[:=]?\s*#?(\d+)/i,
      /(\d+)(?:°|ª)?\s*posto/i,
      /rank\s*[:=]?\s*#?(\d+)/i,
      /position\s*[:=]?\s*#?(\d+)/i,
      /#(\d+)\s*\/\s*\d+/i,
      /(\d+)\s*of\s*\d+/i,
      /finished\s*#?(\d+)/i,
      /placement\s*#?(\d+)/i,
      /#?(\d+)\s*place\s*in\s*squad/i,
      /squad\s*placed\s*#?(\d+)/i,
      /team\s*placed\s*#?(\d+)/i,
      /(\d+)(?:st|nd|rd|th)?\s*in\s*lobby/i,
      /(1st|2nd|3rd|\d+th)/i,
      /#(\d{1,3})\b/,
      /\b(\d{1,3})\s*(?:place|posizione|posto)/i
    ];

    for (const pattern of placementPatterns) {
      const match = text.match(pattern);
      if (match) {
        const val = match[1];
        if (['1st','2nd','3rd'].includes(val)) {
          data.placement = parseInt(val);
        } else if (val.endsWith('th')) {
          data.placement = parseInt(val);
        } else {
          data.placement = parseInt(val);
        }
        break;
      }
    }

    // Fallback: cerca numeri isolati vicino a "place" o "posizione"
    if (!data.placement) {
      const lines = text.split('\n');
      for (const line of lines) {
        if (line.includes('place') || line.includes('posizione') || line.includes('posto') || line.includes('classifica')) {
          const numMatch = line.match(/\d{1,3}/);
          if (numMatch) {
            data.placement = parseInt(numMatch[0]);
            break;
          }
        }
      }
    }

    return data;

  } catch (error) {
    console.error('Errore OCR:', error);
    throw error;
  }
}

module.exports = {
  extractWarzoneData,
  calculatePoints,
  getPlacementMultiplier,
  preprocessImage
};