# Grant Crosswalk

A self-contained, privacy-first web application that reads scholars' CVs, finds
genuine complementarities among them, and matches them to a research topic or a
funding opportunity — in both directions. It runs entirely in the browser. No
server, no account, no data leaves the device unless you deliberately turn on
the optional AI layer.

The interface follows a ledger-and-crosswalk visual language on purpose:
hairline rules instead of drop shadows, a serif for headings and monospace for
scores and tags (the way a printed ledger sets its numbers apart from its
prose), and warm paper, brass, and forest-green in place of the teal-and-blue
SaaS palette most generated tools default to. Start on the Roster tab; it's
the first thing you see, and everything else follows from what's in it.

The tool answers four questions that recur across a research university:

1. **Given this RFP, who on our faculty should respond, and as what team?**
   The primary workflow. Paste a solicitation or a topic; the app ranks your
   roster, assembles a coverage-maximising team, and shows what each member
   contributes and what the opportunity still leaves uncovered.
2. **Where are our capability gaps?** The tool names the RFP requirements that
   no one in your roster can address, which is exactly the information a
   sponsored-programs office needs to decide between an internal team, an
   external partner, or a targeted hire.
3. **Who works well with whom, regardless of any single RFP?** The Team
   Explorer surfaces complementary pairs and the connectors who can hold an
   interdisciplinary team together.
4. **Given this scholar, what should they apply to?** The reverse of the
   primary workflow: Find Funding takes one CV and searches Grants.gov for
   open or forecasted opportunities that match it, ranked and explained the
   same way. This is the one feature that talks to the network, and it is off
   until you turn it on; see "Find Funding" below.

## Who it is for

For an individual scholar and a few collaborators, it turns a folder of CVs into
concrete, fundable collaboration ideas. For a graduate school dean or a vice
president for research, it becomes a standing capability: build the roster of
faculty CVs once, and every new RFP becomes a fast, explainable query with a
defensible shortlist and a gap analysis attached.

The value proposition is deliberate. Sensitive faculty documents never leave the
machine, so there is no data-governance obligation to clear before use. There is
no infrastructure to procure or maintain. And every score decomposes into the
specific terms that produced it, so a shortlist can be explained to a committee
rather than asserted.

## Running it

The app is a set of static files. Two ways to use it:

The quickest full-featured way is to serve the folder over a local web server,
which enables offline installation and the service worker:

```
cd scholar-partner-finder
python3 -m http.server 8000
```

Then open `http://localhost:8000` and, if you want it as a desktop or mobile
app, use your browser's **Install** option. Once installed it works offline.

You can also open `index.html` directly by double-clicking it. Parsing and
analysis work this way; only the installable/offline service worker is
unavailable from a `file://` origin.

To try it immediately, open the Roster tab and choose **Load 8 sample
scholars**, then go to RFP Talent Search and click **Analyze**.

## Using it

**Roster.** Add CVs by dropping files, choosing files, or choosing a folder.
The folder picker reads every CV in a directory, including a locally synced
OneDrive or shared-drive folder, without any cloud credentials. You can also
paste a single CV as text. Because automated reading of a CV is never perfect,
every scholar is fully editable: open a scholar to correct the name and
affiliation, remove any mis-detected capability, and add tags the parser missed.
Curated tags are weighted strongly in the analysis.

**RFP Talent Search.** Paste the opportunity, adjust how much weight to place on
topic relevance versus recent activity versus funding record, set a team size,
and analyze. You get an explainable ranking, a recommended team with per-member
contributions and coverage and complementarity metrics, a capacity-gap list, and
collaboration topics. Everything can be exported as a self-contained HTML report.

**Team Explorer.** Independent of any RFP, this shows the most complementary
pairs in your roster, the bridge scholars who connect many others, and a
greedy-assembled complementary team around an optional seed person. If the
optional AI layer is enabled, its complementary-team mode can also draft
richer collaboration proposals, the same feature RFP Talent Search offers.

**Find Funding.** Pick a scholar from your roster, or paste a CV that isn't in
it, and search for open or forecasted federal funding opportunities that match
their profile. This is the RFP Talent Search idea run in reverse: one scholar
against many candidate opportunities, using the same TF-IDF/cosine engine, so
matches are explained by the same shared terms rather than a bare score. It
queries [Grants.gov's public search API](https://grants.gov/api/api-guide),
which is documented as requiring no login and no API key, deliberately in
preference to scraping the grants.gov website. It is **off by default**; see
"Live funding search" in Settings before it will do anything, and see the
caveats below. If the optional AI layer is enabled, it can also draft a short
fit rationale and proposal angle for the top-ranked matches.

**Settings.** Configure the optional AI layer and the optional live funding
search, toggle enhanced PDF parsing, and export or import your roster as JSON
for backup or transfer.

**The optional AI layer, everywhere it appears.** Off by default and
bring-your-own-key throughout. Roster: improves tag extraction and adds a
one-sentence profile summary (this is the only path that sends raw CV text,
gated by its own separate consent checkbox). RFP Talent Search and Team
Explorer: drafts richer, less templated collaboration-topic proposals for an
assembled team, and can suggest concretely how to close a specific capacity
gap (what kind of partner or hire would fill it). Find Funding: drafts a fit
rationale for the top-ranked opportunities. Everywhere except the CV-text
path, only capability-level data (tags, gap terms, public opportunity text)
is sent, never the CV itself.

**Providers.** Anthropic (Claude) has its own request format; every other
option — OpenAI, Google Gemini, xAI's Grok, a locally-running Ollama, or any
other OpenAI-compatible endpoint (Azure OpenAI, OpenRouter, vLLM, LM Studio,
etc.) — is called through the same OpenAI-style `/chat/completions` request,
since all of them now support it. Ollama needs no API key (it ignores
whatever string is sent) and runs entirely on your machine, but note that
Ollama's default CORS policy only allows `localhost` origins: if you're
running this app locally too, it should just work; if you're using a copy of
this app hosted elsewhere, Ollama will block it unless you set
`OLLAMA_ORIGINS` to include that page's address.
is sent, never the CV itself.

## Data and privacy

All CV text, extracted profiles, and your roster are stored locally in the
browser's IndexedDB. Nothing is transmitted anywhere by default. The roster
export deliberately strips any stored API key. The optional AI layer is off
until you enable it, requires your own API key, and sends data only to the
provider endpoint you select; sending CV text for enhanced extraction requires a
second, explicit consent checkbox.

## Find Funding: what it sends, and what can go wrong

Turning on live funding search (Settings &rarr; Live funding search) changes
the privacy story in one specific, bounded way: it sends a scholar's top few
research terms &mdash; never their CV text &mdash; to Grants.gov's public
`search2` API, and, for the strongest matches, a follow-up request for that
opportunity's full synopsis text so the ranking has something more than a
title to work with. Nothing else in the app makes a network call by default.

Two things are worth knowing before you rely on it:

- **This app has no server, and Grants.gov's API is not formally documented as
  supporting arbitrary browser cross-origin requests.** The request is made
  directly from your browser. If your browser blocks it, Find Funding shows a
  plain error and a link that opens the same search on grants.gov itself in a
  new tab, rather than failing silently. If you hit this consistently and want
  the feature to work end to end, the fix that preserves the "nothing runs on
  a server you don't control" design is a tiny local relay: run
  `node tools/grants-proxy.js` alongside the app (see that file) and it will
  simply forward the request from `localhost`, which browsers treat as same
  machine, not a third party.
- **The response schema is not pinned down by a formal, versioned spec.**
  `js/opportunities.js` reads known field-name aliases and falls back to a
  "longest plain-text field in the record" heuristic rather than assuming one
  exact shape, so a field rename upstream degrades the feature rather than
  breaking it, but the ranking is only as good as the text it recovers. An
  opportunity marked "ranked on title only" in the results list means the
  follow-up detail fetch didn't return a fuller synopsis; open the listing
  itself before deciding it's a miss.

NIH RePORTER and the NSF Award Search API were deliberately left out of this
feature. Both are free, public, documented, no-key APIs, and would be
reasonable to add for a different purpose (seeing who else works in a given
area, based on what's actually been funded), but they return **awarded**
projects, not open calls, so they don't answer "what should this scholar apply
to." Folding them in here would blur a distinction the rest of this project is
otherwise careful to keep separate.

## File formats

Word (`.docx`), plain text, Markdown, RTF, and HTML parse reliably and entirely
offline. PDF text is extracted by a built-in reader that handles most digitally
generated PDFs; scanned PDFs and some unusual font encodings will extract poorly.
For those, paste the text, or enable enhanced PDF parsing in Settings, which
loads the pdf.js library from a CDN and therefore needs a network connection.

## How the analysis works

A short version: each scholar and the RFP are represented as concept vectors
weighted by TF-IDF across your current roster, so distinctive expertise counts
for more than vocabulary everyone shares. Relevance is the cosine similarity
between a scholar and the opportunity. Team assembly maximises weighted coverage
of the RFP's requirements with diminishing returns, which is the formal way to
reward complementarity over redundancy; it is solved greedily. Coverage,
complementarity, overlap, and interdisciplinarity are always reported
separately rather than collapsed into one opaque score. The full reasoning,
including the concept lexicon and the metric definitions, is in
[METHODOLOGY.md](METHODOLOGY.md).

## Project structure

```
index.html              app shell and views
css/styles.css          styles (light/dark, responsive)
js/lexicon.js           curated academic lexicon and stopwords
js/parse.js             CV parsing: PDF, DOCX (built-in), TXT/MD/RTF/HTML
js/extract.js           CV text to structured, section-weighted profile
js/engine.js            TF-IDF, relevance, team assembly, gaps, topics
js/store.js             IndexedDB persistence and JSON export/import
js/llm.js               optional bring-your-own-key AI layer (off by default)
js/samples-data.js      embedded demo scholars and RFP
js/app.js               UI controller
manifest.webmanifest    PWA manifest
service-worker.js       offline app-shell caching
icons/                  app icons
samples/                the demo CVs and RFP as source files
test/                   Node engine harness and headless-browser smoke test
```

## Deploying at an institution

Because the app is static, it can be hosted on any web server or intranet path,
or distributed as a folder. Hosting it over HTTPS lets staff install it as a PWA
and use it offline. No backend, database, or per-user configuration is required.
If a group wants a shared roster, one person can export the JSON and others can
import it; the roster is portable by design.

## Tests

```
node test/run.js            # engine: parsing, profiling, ranking, teams, gaps
node test/browser_smoke.js  # drives the real UI in headless Chromium
```

## Limitations and honest caveats

Extraction is heuristic. The lexicon is broad but finite, and phrase mining
favours precision, so a genuinely novel term may be missed until you add it as a
tag. PDF extraction is best-effort. The relevance and complementarity scores are
useful for ranking and structuring a decision, not a substitute for the judgment
of someone who knows the people involved. The tool is built to make its
reasoning visible precisely so that judgment can be applied to it.

## Acknowledgment

Conceptualization and development: Professor Babu George.

## License

Provided as-is for the author to use, modify, and deploy. No warranty, express
or implied. This tool is intended to support, not replace, human judgment in
funding, hiring, and research-partnership decisions; to the fullest extent
permitted by law, the developer and any affiliated institution disclaim
liability for any loss, damage, or claim arising from its use or from
decisions made in reliance on its output.
