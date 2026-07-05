const ITEM_CATEGORIES_DEFAULT = ['Appliance', 'HVAC', 'Electronics', 'Furniture', 'Plumbing', 'Outdoor', 'Other'];
const PAINT_TYPES_DEFAULT = ['Flat', 'Matte', 'Eggshell', 'Satin', 'Semi-gloss', 'High-gloss', 'Primer', 'Other'];

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/api/vision-analyze' && request.method === 'POST') {
      return handleVisionAnalyze(request, env);
    }
    if (url.pathname === '/api/web-lookup' && request.method === 'POST') {
      return handleWebLookup(request, env);
    }

    return env.ASSETS.fetch(request);
  }
};

function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

function extractJsonObject(text) {
  if (!text) throw new Error('Empty response text.');
  let cleaned = text.trim();
  cleaned = cleaned.replace(/^```json/i, '').replace(/^```/, '').replace(/```$/, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch (e) {
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start !== -1 && end !== -1 && end > start) {
      return JSON.parse(cleaned.slice(start, end + 1));
    }
    throw e;
  }
}

function parseJsonFromTextBlocks(textBlocks) {
  for (let i = textBlocks.length - 1; i >= 0; i--) {
    try {
      return extractJsonObject(textBlocks[i].text);
    } catch (e) {
      continue;
    }
  }
  throw new Error('No parseable JSON found in the response.');
}

async function callAnthropic(env, body) {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify(body)
  });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data) {
    const message = (data && data.error && data.error.message) || 'Anthropic API request failed.';
    throw new Error(message);
  }
  return data;
}

async function handleVisionAnalyze(request, env) {
  if (!env.ANTHROPIC_API_KEY) {
    return json({ error: 'Server is missing the ANTHROPIC_API_KEY secret.' }, 500);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid request body.' }, 400);
  }

  const { kind, mediaType, base64Data, categories, paintTypes } = body || {};
  if (!mediaType || !base64Data) {
    return json({ error: 'Missing image data.' }, 400);
  }

  let prompt;
  if (kind === 'paint') {
    const types = Array.isArray(paintTypes) && paintTypes.length ? paintTypes : PAINT_TYPES_DEFAULT;
    prompt = 'Look at this photo of a paint can label, lid, or swatch card. It may show the color name, paint code, sheen/finish, brand, and a tint or colorant formula table (a small grid of colorant codes like BL, CL, DL, R, Y, W with Oz and fractional amounts, often out of 48, 64, 96, or 384). ' +
      'Reply with ONLY a raw JSON object, no markdown fences and no other text, using exactly these keys: ' +
      '"colorName" (the color name printed on the label, e.g. "Alabaster", otherwise an empty string), ' +
      '"code" (the paint or color code, e.g. "SW 7008", otherwise an empty string), ' +
      '"brand" (the paint brand or manufacturer, e.g. "Sherwin-Williams", otherwise an empty string), ' +
      '"type" (choose exactly one of: ' + types.join(', ') + ', or an empty string if the sheen/finish is not stated), ' +
      '"swatchHex" (your best-guess hex color code for this paint, e.g. "#cbc3ab", based on the swatch or label color, otherwise an empty string), ' +
      '"tintFormula" (an array of objects for each colorant column in a tint/colorant formula table, each with "colorant" the short code such as "BL" or "CL", "oz" the whole-ounce amount as a number, "parts" the fractional amount as a number, and "denominator" the fraction denominator shown on the label such as 48, 64, 96, or 384 — use an empty array if no such table is visible), ' +
      '"notes" (any other detail worth recording, otherwise an empty string). ' +
      'Use an empty string or empty array for anything you cannot determine with reasonable confidence.';
  } else {
    const cats = Array.isArray(categories) && categories.length ? categories : ITEM_CATEGORIES_DEFAULT;
    prompt = 'Look at this photo of a household item. It may show a nameplate, label, or sticker with model and serial details. ' +
      'Reply with ONLY a raw JSON object, no markdown fences and no other text, using exactly these keys: ' +
      '"name" (a short, plain description of the item, e.g. "French-door refrigerator"), ' +
      '"category" (choose exactly one of: ' + cats.join(', ') + '), ' +
      '"brand" (manufacturer or brand name only, otherwise an empty string), ' +
      '"model" (model number if visible on a label, otherwise an empty string), ' +
      '"serial" (serial number if visible on a label, otherwise an empty string), ' +
      '"notes" (any other detail worth recording, otherwise an empty string). ' +
      'Use an empty string for any field you cannot determine with reasonable confidence.';
  }

  try {
    const data = await callAnthropic(env, {
      model: 'claude-sonnet-5',
      max_tokens: 500,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64Data } },
          { type: 'text', text: prompt }
        ]
      }]
    });
    const textBlock = (data.content || []).find((b) => b.type === 'text');
    if (!textBlock || !textBlock.text) {
      return json({ error: 'The model did not return any readable text.' }, 502);
    }
    const parsed = extractJsonObject(textBlock.text);
    return json(parsed, 200);
  } catch (err) {
    return json({ error: String(err.message || err) }, 502);
  }
}

async function handleWebLookup(request, env) {
  if (!env.ANTHROPIC_API_KEY) {
    return json({ error: 'Server is missing the ANTHROPIC_API_KEY secret.' }, 500);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid request body.' }, 400);
  }

  const { kind, query } = body || {};
  if (!query) {
    return json({ error: 'Missing search query.' }, 400);
  }

  let prompt;
  if (kind === 'reference-image') {
    prompt = 'Search the web for a clear catalog or product photo of this specific item: "' + query + '". ' +
      'Look for a manufacturer or major retailer product page and find a direct, publicly hotlinkable image URL for it (the URL itself should end in an image file or be a known direct image-serving URL, not a webpage). ' +
      'When done, your entire final message must be nothing but a raw JSON object — no summary, no explanation, no markdown fences, before or after it. Use exactly these keys: ' +
      '"imageUrl" (the direct image URL, or an empty string if you cannot find a confident one), ' +
      '"sourceName" (the retailer or manufacturer site name), ' +
      '"sourceUrl" (the product page URL you found it on).';
  } else {
    prompt = 'Search the web for the current new retail replacement price of this specific product: "' + query + '". ' +
      'Check at least one or two retailer listings if you can find them. If the exact model is discontinued, find the closest current equivalent. ' +
      'When you are done searching, your entire final message must be nothing but a raw JSON object — no summary, no explanation, no markdown fences, before or after it. Use exactly these keys: ' +
      '"estimatedCost" (a single representative number in USD, no currency symbol or commas), ' +
      '"source" (the retailer or site name the price came from), ' +
      '"note" (one short sentence — mention if this is a comparable replacement rather than the exact original item, otherwise an empty string).';
  }

  try {
    const data = await callAnthropic(env, {
      model: 'claude-sonnet-5',
      max_tokens: 1000,
      tools: [{ type: 'web_search_20250305', name: 'web_search' }],
      messages: [{ role: 'user', content: prompt }]
    });
    const textBlocks = (data.content || []).filter((b) => b.type === 'text');
    if (!textBlocks.length) {
      return json({ error: 'No response text from search.' }, 502);
    }
    const parsed = parseJsonFromTextBlocks(textBlocks);
    return json(parsed, 200);
  } catch (err) {
    return json({ error: String(err.message || err) }, 502);
  }
}
