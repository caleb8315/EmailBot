/**
 * Unit tests for story_id.ts (alert dedup signatures).
 *
 * Run: npx ts-node tests/story_id.test.ts
 */

import {
  isLiveBlogUrl,
  isLiveBlogTitle,
  isLiveBlog,
  storySignature,
} from "../src/story_id";

let passed = 0;
let failed = 0;

function assert(condition: boolean, name: string): void {
  if (condition) {
    passed += 1;
  } else {
    failed += 1;
    console.error(`  FAIL: ${name}`);
  }
}

function section(name: string): void {
  console.log(`\n── ${name} ──`);
}

section("isLiveBlogUrl");
assert(
  isLiveBlogUrl(
    "https://www.theguardian.com/world/live/2026/apr/17/middle-east-crisis-live-news"
  ),
  "detects Guardian /live/ path"
);
assert(
  isLiveBlogUrl("https://www.bbc.com/news/live-12345"),
  "detects BBC /live- path"
);
assert(
  isLiveBlogUrl("https://apnews.com/live-updates/something"),
  "detects AP /live-updates/ path"
);
assert(
  !isLiveBlogUrl(
    "https://www.theguardian.com/world/2026/apr/17/strait-of-hormuz-now-open"
  ),
  "regular dated URL is not flagged"
);
assert(
  !isLiveBlogUrl("not-a-url"),
  "malformed URL returns false without throwing"
);
assert(
  !isLiveBlogUrl(""),
  "empty URL returns false"
);

section("isLiveBlogTitle");
assert(
  isLiveBlogTitle("Middle East crisis live: Iran reopens strait of Hormuz"),
  "detects 'live:' in title"
);
assert(
  isLiveBlogTitle("Ukraine war — live updates, day 500"),
  "detects 'live updates' in title"
);
assert(
  isLiveBlogTitle("Election results live blog — real-time updates"),
  "detects 'live blog' in title"
);
assert(
  isLiveBlogTitle("Champions League final as it happened"),
  "detects 'as it happened'"
);
assert(
  !isLiveBlogTitle("Apple unveils new iPhone"),
  "regular title is not live"
);
assert(
  !isLiveBlogTitle("Going live on radio at 9pm"),
  "benign 'live' without colon/blog/updates is not live blog"
);

section("isLiveBlog (combined)");
assert(
  isLiveBlog(
    "Ongoing coverage of Middle East crisis",
    "https://theguardian.com/world/live/2026/apr/17/crisis"
  ),
  "URL-only live detection"
);
assert(
  isLiveBlog("Middle East crisis live: Iran news", null),
  "title-only live detection"
);
assert(
  !isLiveBlog("iPhone 18 launched", "https://apple.com/news/iphone-18"),
  "neither URL nor title is live"
);

section("storySignature — live-blog collapse");
// Two different daily installments of the same Guardian live blog MUST
// produce the same signature so the per-story cooldown can catch them.
const apr17 = storySignature(
  "Middle East crisis live: Iran reopens strait of Hormuz but US blockade remains",
  "https://www.theguardian.com/world/live/2026/apr/17/middle-east-crisis-live-news-israel-lebanon-ceasefire-iran-war-us"
);
const apr18 = storySignature(
  "Middle East crisis live: Iran to fully open strait of Hormuz during ceasefire",
  "https://www.theguardian.com/world/live/2026/apr/18/middle-east-crisis-live-iran-hormuz-ceasefire-deal-lebanon-israel-oil"
);
assert(
  apr17 !== "" && apr17 === apr18,
  `two live-blog installments share signature ("${apr17}" === "${apr18}")`
);

section("storySignature — unrelated stories diverge");
const iphone = storySignature(
  "Apple unveils M5 MacBook Pro with 24-hour battery",
  "https://www.theguardian.com/technology/2026/apr/17/apple-m5-macbook"
);
assert(iphone !== apr17, "unrelated story has a different signature");
assert(iphone !== "", "non-live story still produces a signature");

section("storySignature — edge cases");
assert(
  storySignature("Explosion", null) === "",
  "single-token title returns empty signature (safety)"
);
assert(
  storySignature("", null) === "",
  "empty title returns empty signature"
);
// Stopword-heavy titles should still extract some signal.
const econ = storySignature(
  "The Fed has raised rates amid ongoing inflation concerns",
  null
);
assert(
  econ.includes("fed") && econ.includes("rates"),
  `extracts meaningful tokens from stopword-heavy title (got "${econ}")`
);

console.log(`\n${"═".repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
console.log("All tests passed.");
