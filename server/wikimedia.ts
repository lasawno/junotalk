/**
 * Wikimedia Cultural Image Service
 *
 * Fetches culturally relevant images from Wikipedia/Wikimedia Commons.
 * No API key required — uses the public Wikipedia REST API.
 *
 * Used by Juno's conversational AI to attach visual context when
 * the user asks about a culture, country, festival, tradition, or food.
 */

export interface WikiImage {
  url: string;
  title: string;
  attribution: string;
  pageUrl: string;
  width?: number;
  height?: number;
}

/** Cultural keywords that trigger an image lookup */
const CULTURE_SIGNALS = [
  // geography / people
  "japanese","chinese","korean","indian","mexican","italian","french","spanish",
  "thai","arabic","persian","turkish","greek","russian","brazilian","nigerian",
  "ethiopian","moroccan","egyptian","vietnamese","indonesian","filipino","pakistani",
  // festivals / events
  "diwali","ramadan","eid","hanukkah","chinese new year","lunar new year","songkran",
  "oktoberfest","carnival","mardi gras","día de los muertos","day of the dead",
  "festival","celebration","tradition","ceremony","ritual","wedding","feast",
  // food & drink
  "cuisine","sushi","ramen","tacos","curry","dim sum","biryani","paella",
  "croissant","baklava","jollof","injera","pho","kimchi","pierogi","tapas",
  // culture / society
  "culture","religion","temple","mosque","church","shrine","monastery",
  "language","dialect","folk","traditional","indigenous","heritage","art",
  "dance","music","clothing","costume","architecture","monument","landmark",
  // countries
  "japan","china","india","mexico","france","germany","italy","spain","brazil",
  "egypt","nigeria","ethiopia","kenya","ghana","iran","iraq","turkey","greece",
  "russia","ukraine","poland","vietnam","indonesia","thailand","philippines",
  "pakistan","bangladesh","nepal","tibet","mongolia","peru","chile","argentina",
  "colombia","cuba","jamaica","portugal","netherlands","sweden","norway","finland",
];

/** Detect whether a query is asking about a culture/place/tradition */
export function isCulturalQuery(query: string): boolean {
  const lower = query.toLowerCase();
  return CULTURE_SIGNALS.some(signal => lower.includes(signal));
}

/** Extract the most likely cultural subject from the query */
function extractSubject(query: string): string {
  const lower = query.toLowerCase();

  // Look for "about X", "tell me about X", "what is X"
  const aboutMatch = lower.match(/(?:about|what is|tell me about|explain|describe)\s+([a-z\s]{3,40}?)(?:\?|$|,|\band\b)/);
  if (aboutMatch) return aboutMatch[1].trim();

  // Find the first culture signal that appears in the query
  for (const signal of CULTURE_SIGNALS) {
    if (lower.includes(signal)) {
      // Extract surrounding context (a few words around the match)
      const idx = lower.indexOf(signal);
      const chunk = query.slice(Math.max(0, idx - 8), idx + signal.length + 20).trim();
      return chunk.length > signal.length ? chunk : signal;
    }
  }

  return query.trim().slice(0, 60);
}

/** Fetch cultural image from Wikipedia for a topic */
export async function fetchCulturalImage(query: string): Promise<WikiImage | null> {
  try {
    const subject = extractSubject(query);
    const encoded = encodeURIComponent(subject);

    // Step 1: Search for the most relevant Wikipedia article
    const searchUrl = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encoded}&srlimit=1&format=json&origin=*`;
    const searchRes = await fetch(searchUrl, { signal: AbortSignal.timeout(5000) });
    if (!searchRes.ok) return null;

    const searchData = await searchRes.json() as any;
    const searchHits = searchData?.query?.search;
    if (!Array.isArray(searchHits) || searchHits.length === 0) return null;

    const pageTitle = searchHits[0].title as string;
    const titleEncoded = encodeURIComponent(pageTitle);

    // Step 2: Fetch the page's main image (thumbnail)
    const imageUrl = `https://en.wikipedia.org/w/api.php?action=query&titles=${titleEncoded}&prop=pageimages|info&inprop=url&format=json&pithumbsize=480&origin=*`;
    const imageRes = await fetch(imageUrl, { signal: AbortSignal.timeout(5000) });
    if (!imageRes.ok) return null;

    const imageData = await imageRes.json() as any;
    const pages = imageData?.query?.pages;
    if (!pages) return null;

    const page = Object.values(pages)[0] as any;
    const thumbUrl = page?.thumbnail?.source;
    const pageUrl  = page?.fullurl || `https://en.wikipedia.org/wiki/${titleEncoded}`;

    if (!thumbUrl) return null;

    return {
      url: thumbUrl,
      title: pageTitle,
      attribution: `Image from Wikipedia — "${pageTitle}"`,
      pageUrl,
      width:  page?.thumbnail?.width,
      height: page?.thumbnail?.height,
    };
  } catch (err: any) {
    if (err.name !== "AbortError") {
      console.warn(`[Wikimedia] Image fetch failed: ${err.message}`);
    }
    return null;
  }
}
