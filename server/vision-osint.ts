/**
 * Juno Vision OSINT Enrichment
 *
 * Pulls public open-source intelligence for identified products/brands:
 *   1. Wikipedia REST API      — brand summary, history, founding info
 *   2. DuckDuckGo Instant Answer — quick verified facts
 *   3. Open Food Facts API     — food product details (calories, ingredients, allergens)
 *   4. Open Library API        — book details (author, year, ISBN)
 *
 * All sources are free, require no API key, and run in parallel.
 * Results are merged and trimmed to keep the response lightweight.
 *
 * Brand isolation: all product-name strings come from server/brand-keys.ts
 */

import { VISION_USER_AGENT } from "./brand-keys";

const OSINT_TIMEOUT_MS = 6000;

export interface OsintResult {
  wikiSummary?: string;
  wikiUrl?: string;
  ddgAbstract?: string;
  ddgSource?: string;
  confirmedLabel?: string;
  confirmedBrand?: string;
  foodFacts?: {
    product?: string;
    brands?: string;
    categories?: string;
    nutriScore?: string;
    calories?: string;
    ingredients?: string;
    allergens?: string;
    quantity?: string;
    countries?: string;
  };
  bookFacts?: {
    title?: string;
    authors?: string;
    year?: string;
    publisher?: string;
    pages?: string;
    subjects?: string;
  };
  enrichedDetails?: string;
  sources: string[];
}

function withOsintTimeout<T>(promise: Promise<T>, label: string): Promise<T | null> {
  return Promise.race([
    promise.catch(err => {
      console.warn(`[VisionOsint] ${label} failed: ${err.message}`);
      return null;
    }),
    new Promise<null>(resolve => setTimeout(() => {
      console.warn(`[VisionOsint] ${label} timed out`);
      resolve(null);
    }, OSINT_TIMEOUT_MS)),
  ]);
}

function cleanText(text: string, maxLen = 300): string {
  return text.replace(/\s+/g, " ").trim().slice(0, maxLen);
}

/* ── Wikipedia REST API ── */
async function fetchWikipedia(query: string): Promise<{ summary: string; url: string } | null> {
  const encoded = encodeURIComponent(query.replace(/\s+/g, "_"));
  const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${encoded}`;
  const res = await fetch(url, {
    headers: { "User-Agent": VISION_USER_AGENT },
    signal: AbortSignal.timeout(OSINT_TIMEOUT_MS),
  });
  if (!res.ok) return null;
  const data = await res.json() as any;
  if (data.type === "disambiguation" || !data.extract) return null;
  return {
    summary: cleanText(data.extract, 350),
    url: data.content_urls?.desktop?.page || `https://en.wikipedia.org/wiki/${encoded}`,
  };
}

/* ── DuckDuckGo Instant Answer API ── */
async function fetchDuckDuckGo(query: string): Promise<{ abstract: string; source: string } | null> {
  const encoded = encodeURIComponent(query);
  const url = `https://api.duckduckgo.com/?q=${encoded}&format=json&no_html=1&skip_disambig=1&no_redirect=1`;
  const res = await fetch(url, {
    headers: { "User-Agent": VISION_USER_AGENT },
    signal: AbortSignal.timeout(OSINT_TIMEOUT_MS),
  });
  if (!res.ok) return null;
  const data = await res.json() as any;
  const text = data.AbstractText || data.Abstract || "";
  if (!text || text.length < 20) return null;
  return {
    abstract: cleanText(text, 300),
    source: data.AbstractSource || data.AbstractURL || "DuckDuckGo",
  };
}

/* ── Open Food Facts ── */
async function fetchFoodFacts(query: string): Promise<OsintResult["foodFacts"] | null> {
  const encoded = encodeURIComponent(query);
  const searchUrl = `https://world.openfoodfacts.org/cgi/search.pl?search_terms=${encoded}&search_simple=1&action=process&json=1&page_size=1`;
  const res = await fetch(searchUrl, {
    headers: { "User-Agent": VISION_USER_AGENT },
    signal: AbortSignal.timeout(OSINT_TIMEOUT_MS),
  });
  if (!res.ok) return null;
  const data = await res.json() as any;
  const product = data?.products?.[0];
  if (!product) return null;
  return {
    product: product.product_name || undefined,
    brands: product.brands || undefined,
    categories: product.categories_tags?.slice(0, 3).map((c: string) => c.replace("en:", "")).join(", ") || undefined,
    nutriScore: product.nutrition_grade_fr?.toUpperCase() || undefined,
    calories: product.nutriments?.["energy-kcal_100g"]
      ? `${Math.round(product.nutriments["energy-kcal_100g"])} kcal/100g`
      : undefined,
    ingredients: product.ingredients_text_en
      ? cleanText(product.ingredients_text_en, 200)
      : undefined,
    allergens: product.allergens_hierarchy?.map((a: string) => a.replace("en:", "")).join(", ") || undefined,
    quantity: product.quantity || undefined,
    countries: product.countries || undefined,
  };
}

/* ── Open Library (books) ── */
async function fetchBookFacts(query: string): Promise<OsintResult["bookFacts"] | null> {
  const encoded = encodeURIComponent(query);
  const url = `https://openlibrary.org/search.json?q=${encoded}&limit=1&fields=title,author_name,first_publish_year,publisher,number_of_pages_median,subject`;
  const res = await fetch(url, {
    headers: { "User-Agent": VISION_USER_AGENT },
    signal: AbortSignal.timeout(OSINT_TIMEOUT_MS),
  });
  if (!res.ok) return null;
  const data = await res.json() as any;
  const doc = data?.docs?.[0];
  if (!doc) return null;
  return {
    title: doc.title || undefined,
    authors: doc.author_name?.slice(0, 2).join(", ") || undefined,
    year: doc.first_publish_year ? String(doc.first_publish_year) : undefined,
    publisher: Array.isArray(doc.publisher) ? doc.publisher[0] : undefined,
    pages: doc.number_of_pages_median ? String(doc.number_of_pages_median) : undefined,
    subjects: doc.subject?.slice(0, 3).join(", ") || undefined,
  };
}

/* ── Category classifier ── */
function isFoodQuery(label: string, yoloCategories: string[]): boolean {
  const foodWords = [
    "food", "drink", "beverage", "snack", "chocolate", "bread", "milk", "juice",
    "bottle", "can", "cereal", "fruit", "vegetable", "meat", "cheese", "yogurt", "sauce",
    "soda", "water", "coffee", "tea", "beer", "wine", "chip", "cookie", "cake", "pizza",
    // energy/hydration drinks
    "hydration", "hydrate", "energy", "electrolyte", "supplement", "protein", "powder",
    "sports", "nutrition", "recovery", "pre-workout", "preworkout", "creatine",
    "amino", "vitamin", "mineral", "kombucha", "sparkling", "sparkling water",
    "ghost", "prime", "celsius", "gatorade", "powerade", "monster", "redbull",
  ];
  const combined = (label + " " + yoloCategories.join(" ")).toLowerCase();
  return foodWords.some(w => combined.includes(w));
}

function isBookQuery(label: string, yoloCategories: string[]): boolean {
  const bookWords = ["book", "novel", "textbook", "magazine", "comic"];
  const combined = (label + " " + yoloCategories.join(" ")).toLowerCase();
  return bookWords.some(w => combined.includes(w));
}

/* ── Compose enriched details string ── */
function buildEnrichedDetails(
  brand: string | undefined,
  label: string,
  wiki: { summary: string; url: string } | null,
  ddg: { abstract: string; source: string } | null,
  food: OsintResult["foodFacts"] | null,
  book: OsintResult["bookFacts"] | null
): string {
  const parts: string[] = [];

  if (wiki?.summary) parts.push(wiki.summary);
  else if (ddg?.abstract) parts.push(ddg.abstract);

  if (food) {
    const foodParts: string[] = [];
    if (food.calories) foodParts.push(`Calories: ${food.calories}`);
    if (food.nutriScore) foodParts.push(`Nutri-Score: ${food.nutriScore}`);
    if (food.allergens) foodParts.push(`Allergens: ${food.allergens}`);
    if (food.categories) foodParts.push(`Category: ${food.categories}`);
    if (foodParts.length) parts.push(foodParts.join(". ") + ".");
    if (food.ingredients) parts.push(`Ingredients: ${food.ingredients}`);
  }

  if (book) {
    const bookParts: string[] = [];
    if (book.authors) bookParts.push(`by ${book.authors}`);
    if (book.year) bookParts.push(`published ${book.year}`);
    if (book.publisher) bookParts.push(`(${book.publisher})`);
    if (book.pages) bookParts.push(`${book.pages} pages`);
    if (bookParts.length) parts.push(bookParts.join(", ") + ".");
    if (book.subjects) parts.push(`Topics: ${book.subjects}`);
  }

  return parts.slice(0, 3).join(" ").trim();
}

/* ── Public entry point ── */
export async function enrichVisionResult(
  brand: string | undefined,
  label: string,
  yoloCategories: string[] = [],
  blipCaption?: string
): Promise<OsintResult> {
  const sources: string[] = [];

  // Build query candidates: try full label first, then brand alone, then just label
  // If BLIP caption adds extra product context (e.g. "a can of ghost energy drink"),
  // extract meaningful nouns from it to supplement the search
  const fullLabel = [brand, label].filter(Boolean).join(" ").trim();
  const brandOnly = brand || label;

  // Extract a clean 3-word product hint from BLIP caption if available
  let blipHint: string | undefined;
  if (blipCaption) {
    const stopWords = new Set(["a", "an", "the", "of", "with", "and", "or", "in", "on", "is", "are", "it"]);
    const words = blipCaption.toLowerCase().split(/\s+/).filter(w => !stopWords.has(w) && w.length > 2);
    if (words.length >= 2) blipHint = words.slice(0, 4).join(" ");
  }

  const queries = [...new Set([fullLabel, brandOnly, label, blipHint].filter(Boolean))] as string[];

  // Include BLIP caption words in food/book detection so a caption like
  // "a can of ghost energy drink" correctly triggers food fact lookup
  const captionWords = blipCaption ? blipCaption.split(/\s+/) : [];
  const isFood = isFoodQuery(label + " " + captionWords.join(" "), yoloCategories);
  const isBook = isBookQuery(label + " " + captionWords.join(" "), yoloCategories);

  // Wikipedia: try full label first; fall back to brand-only if it returns nothing useful
  let wiki: { summary: string; url: string } | null = null;
  for (const q of queries) {
    const candidate = await withOsintTimeout(fetchWikipedia(q), `Wikipedia(${q})`);
    if (candidate?.summary && candidate.summary.length > 50) {
      wiki = candidate;
      break;
    }
  }

  // DuckDuckGo: try full label, fall back to brand
  let ddg: { abstract: string; source: string } | null = null;
  for (const q of queries) {
    const candidate = await withOsintTimeout(fetchDuckDuckGo(q), `DDG(${q})`);
    if (candidate?.abstract && candidate.abstract.length > 20) {
      ddg = candidate;
      break;
    }
  }

  // Food Facts + Book: run against full label query for best match
  const [food, book] = await Promise.all([
    isFood ? withOsintTimeout(fetchFoodFacts(fullLabel || brandOnly), "OpenFoodFacts") : Promise.resolve(null),
    isBook ? withOsintTimeout(fetchBookFacts(fullLabel || brandOnly), "OpenLibrary") : Promise.resolve(null),
  ]);

  if (wiki) sources.push("Wikipedia");
  if (ddg) sources.push("DuckDuckGo");
  if (food) sources.push("Open Food Facts");
  if (book) sources.push("Open Library");

  // Cross-reference: if OpenFoodFacts confirmed a canonical product/brand name, surface it
  const confirmedLabel = food?.product && food.product.length > 2 ? food.product : undefined;
  const confirmedBrand = food?.brands && food.brands.length > 2 ? food.brands.split(",")[0].trim() : undefined;

  const enrichedDetails = buildEnrichedDetails(brand, label, wiki, ddg, food, book);

  return {
    wikiSummary: wiki?.summary,
    wikiUrl: wiki?.url,
    ddgAbstract: ddg?.abstract,
    ddgSource: ddg?.source,
    confirmedLabel,
    confirmedBrand,
    foodFacts: food ?? undefined,
    bookFacts: book ?? undefined,
    enrichedDetails: enrichedDetails || undefined,
    sources,
  };
}
