# Scholar Partner Finder

A self-contained, privacy-first web application that reads scholars' CVs, looks
for complementarities among them, and matches them to a research topic or a
funding opportunity. It runs entirely in the browser. There is no server and no
account, and no data leaves the device unless you deliberately turn on the
optional AI layer.

The tool is meant to structure a decision, not to make it. Every figure it
reports is an aid to the judgment of someone who knows the people involved, and
the design goes to some length to keep that judgment in the loop rather than to
replace it.

It addresses three questions that recur across a research university:

1. **Given this RFP, who might respond, and as what team?**
   The primary workflow. Paste a solicitation or a topic; the app ranks your
   roster, assembles a coverage-maximising team, and shows what each member
   contributes and what the opportunity still leaves uncovered.
2. **Where are the capability gaps?** The tool names the RFP requirements that
   no one in your roster appears to address, which is the kind of information a
   sponsored-programs office can use when weighing an internal team against an
   external partner or a targeted hire.
3. **Who might work well with whom, regardless of any single RFP?** The Team
   Explorer surfaces complementary pairs and the connectors who can help hold an
   interdisciplinary team together.

## Who it is for

For an individual scholar and a few collaborators, it turns a folder of CVs into
concrete starting points for collaboration. For a graduate school dean or a vice
president for research, it can become a standing aid: build a roster of faculty
CVs once, and each new RFP becomes a fast, explainable query with an
accompanying gap analysis.

The design is deliberate on three points. Sensitive faculty documents stay on
the machine, so there is no data transfer to clear before use. There is no
infrastructure to procure or maintain. And every score decomposes into the
specific terms that produced it, so a shortlist can be explained to a committee
rather than merely asserted. None of this makes the output authoritative; it
makes the output inspectable.

## Projects

Work is organized into projects (workspaces). Each project holds its own roster,
kept separate from every other project, so a search for one opportunity never
draws on scholars you added for another, and one department's roster does not
mix with another's. A project switcher sits in the top bar, and the Settings
tab lets you create, open, rename, and delete projects. Deleting a project
removes only that project's scholars; the others are untouched.

The bundled demo data lives in its own **Sample data** project, marked as a
demo. Loading the samples creates and switches to that project, so the example
scholars never land in a roster you are building for real work. The demo project
does not accept your own uploads; if you try to add a CV while it is active, the
app offers to create a real project instead.

If you used an earlier version, your existing roster is preserved on first
launch and placed in a project called **My first project**.

## Running it

The app is a set of static files. There are two ways to use it.

The fuller way is to serve the folder over a local web server, which enables
offline installation and the service worker:

```
cd scholar-partner-finder
python3 -m http.server 8000
```

Then open `http://localhost:8000` and, if you want it as a desktop or mobile
app, use your browser's **Install** option. Once installed it works offline.

You can also open `index.html` directly by double-clicking it. Parsing and
analysis work this way; only the installable and offline service worker is
unavailable from a `file://` origin.

To try it immediately, open the Roster tab and choose **Load 8 sample
scholars** (this populates the demo project), then go to RFP Talent Search and
click **Analyze**.

## Using it

**Roster.** Add CVs to the active project by dropping files, choosing files, or
choosing a folder. The folder picker reads every CV in a directory, including a
locally synced OneDrive or shared-drive folder, without any cloud credentials.
You can also paste a single CV as text. A search box filters the roster by name,
affiliation, or capability, and importing the same person twice by name is
skipped rather than duplicated. Because automated reading of a CV is never
perfect, every scholar is fully editable: open a scholar to correct the name and
affiliation, remove any mis-detected capability, and add tags the parser missed.
Curated tags are weighted strongly in the analysis.

**RFP Talent Search.** Paste the opportunity, adjust how much weight to place on
topic relevance, recent activity, and funding record, set a team size, and
analyze. You get an explainable ranking, a recommended team with per-member
contributions and coverage and complementarity metrics, a capacity-gap list, and
suggested collaboration topics. Three things keep you in control of the reading:

- The **requirements** the tool extracted from the RFP are shown as editable
  chips. You can remove a phrase that is really program boilerplate, add a
  requirement the call implies but never spells out, and mark a requirement as a
  must, which weights it more heavily. Relevance, coverage, and the gap analysis
  all recompute from the set you approve.
- A **coverage matrix** lays out each requirement against each chosen team
  member, so you can see who addresses what, with the still-uncovered
  requirements highlighted.
- The full ranking lets you **pin** a scholar onto the team or **exclude** one,
  and it notes, for a strong candidate left off, roughly how little new coverage
  they would add and which member they most duplicate. These are the judgments
  the model cannot make, such as availability or a prior collaboration, put back
  in your hands.

Results can be exported as a self-contained HTML report or as a CSV of the
ranking.

**Team Explorer.** Independent of any RFP, this shows the most complementary
pairs in the active project's roster, the bridge scholars who connect many
others, and a greedy-assembled complementary team around an optional seed
person.

**Settings.** Manage projects, configure the optional AI layer, toggle enhanced
PDF parsing, and export or import a project's roster as JSON for backup or
transfer.

## Data and privacy

All CV text, extracted profiles, projects, and rosters are stored locally in the
browser's IndexedDB. Nothing is transmitted anywhere by default. A roster export
covers only the active project and strips any stored API key, and an import
always lands in a new project rather than merging into an existing one. The
optional AI layer is off until you enable it, requires your own API key, and
sends data only to the provider endpoint you select; sending CV text for
enhanced extraction requires a second, explicit consent checkbox.

## File formats

Word (`.docx`), plain text, Markdown, RTF, and HTML parse reliably and entirely
offline. PDF text is extracted by a built-in reader that handles most digitally
generated PDFs; scanned PDFs and some unusual font encodings will extract poorly.
For those, paste the text, or enable enhanced PDF parsing in Settings, which
loads the pdf.js library from a CDN and therefore needs a network connection.

## How the analysis works

In short: each scholar and the RFP are represented as concept vectors weighted
by TF-IDF across the active project's roster, so distinctive expertise counts
for more than vocabulary everyone shares. Relevance is the cosine similarity
between a scholar and the opportunity. Team assembly maximises weighted coverage
of the RFP's requirements with diminishing returns, which is the formal way to
reward complementarity over redundancy; it is solved greedily. Coverage,
complementarity, overlap, and interdisciplinarity are reported separately rather
than collapsed into one opaque score. Because the weighting is computed across
the roster you have loaded, all scores are comparative rather than absolute. The
full reasoning, including the concept lexicon and the metric definitions, is in
[METHODOLOGY.md](METHODOLOGY.md).

## Project structure

```
index.html              app shell and views
css/styles.css          styles (light/dark, responsive)
js/lexicon.js           curated academic lexicon and stopwords
js/parse.js             CV parsing: PDF, DOCX (built-in), TXT/MD/RTF/HTML
js/extract.js           CV text to structured, section-weighted profile
js/engine.js            TF-IDF, relevance, requirement editing, team assembly,
                        coverage matrix, gaps, topics
js/store.js             IndexedDB persistence: projects, profiles, JSON export/import
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
If a group wants to share a roster, one person can export a project as JSON and
others can import it; each import lands in its own project, so shared data stays
distinct from local work.

## Tests

```
node test/run.js            # engine: parsing, profiling, ranking, teams, gaps,
                            #         requirement editing, coverage matrix, constraints
node test/browser_smoke.js  # drives the real UI in headless Chromium,
                            #         including project isolation
```

## Limitations and honest caveats

Extraction is heuristic. The lexicon is broad but finite, and phrase mining
favours precision, so a novel term may be missed until you add it as a tag. PDF
extraction is best-effort. The relevance and complementarity scores are useful
for ranking and for structuring a decision; they are not a measure of a person's
reputation, collegiality, availability, or fit, and they are not a substitute
for the judgment of someone who knows the people involved. The tool is built to
make its reasoning visible precisely so that such judgment can be applied to it,
and it should be used that way.

## Credit

Conceptualized and developed by Professor Babu George
(https://www.linkedin.com/in/beingbabu/).

## Disclaimer and license

Provided as is, without warranties of any kind, express or implied, including
but not limited to warranties of merchantability, fitness for a particular
purpose, and non-infringement. All outputs are heuristic aids intended to
support human judgment, and are not professional, legal, financial, or
employment advice, nor decisions or recommendations. Any reliance on the tool or
its outputs is at your own risk, and the author accepts no responsibility or
liability for any decision, action, outcome, or damages arising from its use.
Verify all results independently before relying on them. You may use, modify, and
deploy the software, and you do so on these terms.
