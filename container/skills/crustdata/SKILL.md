---
name: crustdata
description: Search and enrich company and people data using Crustdata B2B API. Use for company research, people lookup, LinkedIn posts, and competitive intelligence.
allowed-tools: Bash(curl:*)
---

# Crustdata B2B Data API

**Base URL:** `https://api.crustdata.com`
**Auth:** `Authorization: Token $CRUSTDATA_API_KEY` on every request.

## Check Credits

```bash
curl -s -H "Authorization: Token $CRUSTDATA_API_KEY" \
  -H "Content-Type: application/json" \
  https://api.crustdata.com/user/credits | jq .
```

Returns `{"credits": N}` — remaining credits for the billing period.

---

## Company Endpoints

### Company Enrichment (1 credit/company)

Get detailed data for up to 25 companies by domain, name, LinkedIn URL, or Crustdata ID.

```bash
curl -s -H "Authorization: Token $CRUSTDATA_API_KEY" \
  -H "Accept: application/json" \
  "https://api.crustdata.com/screener/company?company_domain=hubspot.com,stripe.com"
```

**Query params** (provide one identifier type):
- `company_domain` — comma-separated domains (up to 25)
- `company_name` — comma-separated names (quote names with commas: `"Acme, Inc."`)
- `company_linkedin_url` — comma-separated LinkedIn URLs
- `company_id` — comma-separated Crustdata IDs
- `fields` — comma-separated field names to include (e.g. `company_name,headcount.linkedin_headcount`)

### Company Identification (free lookup)

Match companies in Crustdata's database. Returns minimal data with match score.

```bash
curl -s -X POST https://api.crustdata.com/screener/identify/ \
  -H "Authorization: Token $CRUSTDATA_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"query_company_website": "stripe.com", "count": 3}'
```

**Body** (at least one required):
- `query_company_name` — company name
- `query_company_website` — website domain
- `query_company_linkedin_url` — LinkedIn URL
- `count` — max results (default 10)

### Company Search (25 credits/page)

Search companies using LinkedIn Sales Navigator-style filters.

```bash
curl -s -X POST https://api.crustdata.com/screener/company/search \
  -H "Authorization: Token $CRUSTDATA_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "filters": [
      {"filter_type": "COMPANY_HEADCOUNT", "type": "in", "value": ["51-200", "201-500"]},
      {"filter_type": "REGION", "type": "in", "value": ["United States"]},
      {"filter_type": "INDUSTRY", "type": "in", "value": ["Software Development"]}
    ],
    "page": 1
  }'
```

**Filter types:** `COMPANY_HEADCOUNT`, `REGION`, `INDUSTRY`, `NUM_OF_FOLLOWERS`, `FORTUNE`, `ACCOUNT_ACTIVITIES`, `JOB_OPPORTUNITIES`, `COMPANY_HEADCOUNT_GROWTH`, `ANNUAL_REVENUE`, `DEPARTMENT_HEADCOUNT`, `DEPARTMENT_HEADCOUNT_GROWTH`, `KEYWORD`

**Filter operators:**
- Text: `"in"` / `"not in"` with array of strings
- Range: `"between"` with `{"min": N, "max": N}` and optional `sub_filter`

**Alt:** Pass `linkedin_sales_navigator_search_url` instead of filters.

25 results per page. Paginate with `page`.

### Company Screening (advanced filters)

Search companies by firmographic criteria, growth metrics, funding, etc.

```bash
curl -s -X POST https://api.crustdata.com/screener/screen/ \
  -H "Authorization: Token $CRUSTDATA_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "metrics": [{"metric_name": "linkedin_headcount_and_glassdoor_ceo_approval_and_g2"}],
    "filters": {
      "op": "and",
      "conditions": [
        {"column": "crunchbase_total_investment_usd", "type": "=>", "value": 5000000, "allow_null": false},
        {"column": "linkedin_headcount", "type": "=>", "value": 50, "allow_null": false},
        {"column": "largest_headcount_country", "type": "(.)", "value": "USA", "allow_null": false}
      ]
    },
    "offset": 0,
    "count": 100
  }'
```

**Filter operators:** `=>` (gte), `=<` (lte), `=`, `>`, `<`, `!=`, `(.)` (contains, case-insensitive), `[.]` (contains, case-sensitive), `in` (matches any in list)

---

## People Endpoints

### People Search — PersonDB (database-backed, cursor pagination)

Search people by title, company, location, seniority, etc. Uses Crustdata's own monthly-updated database. Up to 100 results per page. Supports 60+ filters with AND/OR nesting.

```bash
curl -s -X POST https://api.crustdata.com/screener/persondb/search \
  -H "Authorization: Token $CRUSTDATA_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "filters": [
      {"filter_type": "CURRENT_COMPANY", "type": "in", "value": ["Google", "Microsoft"]},
      {"filter_type": "CURRENT_TITLE", "type": "in", "value": ["VP Engineering", "CTO"]},
      {"filter_type": "REGION", "type": "in", "value": ["United States"]},
      {"filter_type": "SENIORITY_LEVEL", "type": "in", "value": ["CXO", "Vice President", "Director"]}
    ],
    "limit": 100
  }'
```

**Filter types:** `CURRENT_COMPANY`, `CURRENT_TITLE`, `PAST_TITLE`, `COMPANY_HEADQUARTERS`, `COMPANY_HEADCOUNT`, `REGION`, `INDUSTRY`, `PROFILE_LANGUAGE`, `SENIORITY_LEVEL`, `YEARS_AT_CURRENT_COMPANY`, `YEARS_IN_CURRENT_POSITION`, `YEARS_OF_EXPERIENCE`, `FIRST_NAME`, `LAST_NAME`, `FUNCTION`, `PAST_COMPANY`, `COMPANY_TYPE`, `POSTED_ON_LINKEDIN`, `RECENTLY_CHANGED_JOBS`, `IN_THE_NEWS`, `KEYWORD`

**Filter operators:** `in`, `not in`, `between` (with `{"min": N, "max": N}` for ranges). Filters combine with AND by default; use nested `{"op": "or", "conditions": [...]}` for OR logic.

**Pagination:** Response includes `next_cursor` when more pages exist. Pass `"cursor": "<next_cursor>"` in subsequent requests. Up to 100 results per page via `limit`.

### People Enrichment (3 credits/profile, database only)

Enrich up to 25 LinkedIn profiles at once from the database.

```bash
curl -s -H "Authorization: Token $CRUSTDATA_API_KEY" \
  "https://api.crustdata.com/screener/person/enrich?linkedin_profile_url=https://www.linkedin.com/in/johndoe/"
```

**Query params** (provide one):
- `linkedin_profile_url` — comma-separated URLs (up to 25)
- `business_email` — single email address
- `fields` — comma-separated field names

---

## LinkedIn Posts

### Posts by Keyword (5 credits/page)

Real-time keyword search across LinkedIn posts.

```bash
curl -s -X POST https://api.crustdata.com/screener/linkedin_posts/keyword_search/ \
  -H "Authorization: Token $CRUSTDATA_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"keyword": "AI agents", "page": 1, "sort_by": "relevance", "date_posted": "past-week"}'
```

**Params:**
- `keyword` (required) — search term
- `page` (default 1) — page number
- `limit` (default 5, max 5 with page) — posts per page
- `sort_by` — `"relevance"` or `"date_posted"` (default)
- `date_posted` — `"past-24h"`, `"past-week"`, `"past-month"`, `"past-quarter"`, `"past-year"`

Latency: 5-10 seconds.

### Posts by Company or Person (5 credits/page)

Fetch recent LinkedIn posts for a specific company or person.

```bash
# By company domain
curl -s -H "Authorization: Token $CRUSTDATA_API_KEY" \
  "https://api.crustdata.com/screener/linkedin_posts?company_domain=crustdata.com&page=1"

# By person LinkedIn URL
curl -s -H "Authorization: Token $CRUSTDATA_API_KEY" \
  "https://api.crustdata.com/screener/linkedin_posts?person_linkedin_url=https://linkedin.com/in/johndoe&page=1"
```

**Query params** (provide one identifier):
- `company_domain`, `company_name`, `company_id`, `company_linkedin_url` (for company)
- `person_linkedin_url` (for person)
- `page` (default 1), `limit` (default 5)
- `post_types` — `"original"`, `"repost"`, or `"repost,original"` (default)
- `fields=reactors` — include reactor profiles (25 credits/page instead of 5)

Up to 20 pages. Latency: 30-60 seconds.

---

## Web Search (1 credit/query)

Structured web search with entity-linked results. Rate limit: 15 req/min.

```bash
curl -s -X POST https://api.crustdata.com/screener/web-search \
  -H "Authorization: Token $CRUSTDATA_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"query": "OpenAI company news", "geolocation": "us", "sources": ["news"]}'
```

**Body:**
- `query` (required) — search term (up to 1000 chars, supports `site:`, `filetype:`)
- `geolocation` — ISO country code (e.g. `"us"`)
- `sources` — array of `"news"`, `"web"`, `"scholar-articles"`, `"scholar-articles-enriched"`, `"scholar-author"`
- `site` — restrict to domain
- `startDate` / `endDate` — Unix timestamps

---

## Reference Values

For valid filter values (region names, industries, etc.):
- Regions: `https://crustdata-docs-region-json.s3.us-east-2.amazonaws.com/updated_regions.json`
- Industries: `https://crustdata-docs-region-json.s3.us-east-2.amazonaws.com/industry_values.json`

## Important: No Real-Time Endpoints

Real-time enrichment endpoints (`enrich_realtime=True`) are **off-limits** per the YC deal. Always use database-backed endpoints only. For people search, use `/screener/persondb/search` instead of `/screener/person/search`.

## Credits Summary

| Endpoint | Credits |
|----------|---------|
| Company Enrichment | 1/company |
| Company Identification | Free |
| Company Search | 25/page |
| People Search (PersonDB) | per page |
| People Enrichment (database) | 3/profile |
| LinkedIn Posts (keyword) | 5/page |
| LinkedIn Posts (company/person) | 5/page (25 with reactors) |
| Web Search | 1/query |
| Credits Check | Free |

Always check credits before running expensive queries. Summarize results concisely for the user.
