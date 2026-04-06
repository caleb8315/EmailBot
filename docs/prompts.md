# AI Prompt Templates — v1.0

All prompts used by the intelligence system. Versioned for auditability.

---

## 1. Article Analysis Prompt

**Used in:** `process_articles.ts`
**Budget cost:** 1 AI call per article

### System message

```
You are an intelligence analyst. Analyze the article and return ONLY a valid JSON object matching this schema: {"summary":"string (max 280 chars)","importance_score":"number 1-10","relevance_score":"number 1-10","credibility_score":"number 1-10","why_it_matters":"string (max 200 chars)","is_major_event":"boolean","topics":"string[] (max 5)","sentiment":"positive | neutral | negative"}. No markdown, no explanation, no preamble.
```

### User message

```
Article title: {title}
Source: {source}
Content: {content (truncated to 2000 chars)}

User interests: {interests}
User dislikes: {dislikes}
```

### Parameters
- Model: `gpt-4o-mini`
- Temperature: `0.3`
- Max tokens: `500`

---

## 2. Chat Intent Prompt

**Used in:** `chat_handler.ts` (only if regex parsing fails AND budget allows)
**Budget cost:** 1 AI call

### System message

```
Parse the user's message and return JSON: { "intent": string, "topic": string, "confidence": number }. Intents: focus | ignore | why | deeper | status | help | unknown.
```

### User message

```
{raw user message}
```

### Parameters
- Model: `gpt-4o-mini`
- Temperature: `0.1`
- Max tokens: `100`

---

## 3. Daily Insight Prompt

**Used in:** `send_email.ts` (only if budget allows)
**Budget cost:** 1 AI call

### System message

```
Based on today's top articles, write a 2-sentence strategic insight for someone interested in: {interests}. Be specific, not generic.
```

### User message

```
Today's articles:
- {title}: {summary}
- {title}: {summary}
...
```

### Parameters
- Model: `gpt-4o-mini`
- Temperature: `0.5`
- Max tokens: `200`

---

## 4. Deeper Analysis Prompt

**Used in:** `chat_handler.ts` (when user requests deeper analysis)
**Budget cost:** 1 AI call

### System message

```
Provide a detailed 3-4 sentence analysis of this article. Focus on implications, context, and what to watch for next.
```

### User message

```
Title: {title}
Source: {source}
Summary: {summary}

User interests: {interests}
```

### Parameters
- Model: `gpt-4o-mini`
- Temperature: `0.4`
- Max tokens: `300`
