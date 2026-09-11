# Methodology

This document sets out how Grant Crosswalk turns unstructured CVs into
rankings, teams, and gap analyses. The aim is not sophistication for its own
sake but transparency: every number the tool reports should be traceable to a
stated rule and, ultimately, to specific words in the source documents. What
follows is written so that a reader can decide how much to trust each output and
where its judgment should override the arithmetic.

## From CV to profile

A CV is first reduced to plain text, then segmented into sections using a table
of common headings (research, publications, grants, teaching, service, and so
on). Segmentation matters because not all parts of a CV carry equal signal: a
phrase appearing under research interests or technical skills is a stronger claim
of expertise than the same phrase buried in a teaching list. Each section
therefore carries a weight, and phrases are counted with that weight applied.

Two kinds of concept are extracted. The first is a set of canonical
capabilities recognised from a curated lexicon spanning methods, disciplines,
funders, research infrastructure, and cross-cutting themes. The lexicon collapses
surface variants onto a single canonical form, so that "machine-learning",
"machine learning", and "ML" are treated as one capability. The second is a set
of salient free phrases mined as one-to-three word n-grams, filtered to avoid
boilerplate. Together these form the scholar's concept vector, with a raw weight
per concept that reflects how often and how prominently it appears.

Extraction is deliberately exposed to the user. No automated reader of a CV is
reliable enough to be trusted silently, so each profile is fully editable:
mis-detected capabilities can be removed and missing ones added, and manual tags
are given a strong weight because they represent a deliberate human judgment.

## Weighting concepts: why TF-IDF

Raw frequency is a poor measure of what makes a scholar distinctive. The word
"research" appears in every CV and tells you nothing about who differs from whom.
The tool therefore weights each concept by term frequency times inverse document
frequency, computed across the current roster (and the RFP, treated as one more
document). A concept that many scholars list receives a low inverse-document-
frequency weight; a concept only a few share receives a high one. This is the
standard information-retrieval device, and it is doing real work here: it is what
lets the roster surface distinctive, combinable expertise rather than generic
overlap. A consequence worth stating plainly is that all scores are relative to
the roster you have loaded. Adding or removing scholars changes the weighting,
which is correct behavior but means scores are comparative, not absolute.

## Relevance to an opportunity

The RFP is analyzed into a requirement set by the same machinery, with an added
filter. A funding announcement is full of program boilerplate ("proposals",
"solicitation", "broader impacts") that carries no topical content, so the tool
keeps every recognised lexicon capability plus only the most salient, non-
boilerplate multi-word phrases. This is why the requirement list reads as a set
of real capabilities rather than a transcript of the announcement.

A scholar's relevance to the opportunity is the cosine similarity between the
scholar's concept vector and the RFP's, both in the inverse-document-frequency
weighted space. Cosine similarity is bounded between zero and one, is symmetric,
and, most usefully, decomposes: the score is a sum of contributions from shared
concepts, so the tool can always show the specific terms that produced it. The
ranking shown to the user is a composite of this relevance with two optional
factors, recent activity and funding record, each normalised across the roster
and weighted by user-set sliders. The default places most weight on relevance;
the other two exist because a dean may reasonably care about track record, and
making that preference explicit is better than hiding it.

## Complementarity and team assembly

The central idea of the tool is that a good team is not a set of the individually
highest-scoring people. It is a set whose strengths interlock to cover the
opportunity, with as little wasted redundancy as possible. Formally, this is the
weighted maximum-coverage problem.

For each RFP requirement, the tool measures how strongly the best-matching member
addresses it, normalised so that the strongest available scholar on that
requirement scores one. A team's coverage is the requirement-weighted sum of
these best-member strengths, expressed as a fraction of total requirement weight.
The key property is diminishing returns: once a requirement is well covered by
one member, adding a second person strong in the same area contributes almost
nothing to coverage, whereas a person who addresses a still-uncovered requirement
contributes a great deal. Maximising coverage therefore rewards complementarity
directly.

Because maximum coverage is NP-hard, the team is assembled greedily: start empty,
and repeatedly add the candidate whose marginal contribution to coverage is
largest, subject to a minimum relevance floor so that no one is added merely to
tick an obscure box. Greedy selection is not arbitrary here; for this class of
problem it is guaranteed to reach at least a (1 - 1/e), roughly sixty-three
percent, fraction of the optimum, and in practice on rosters of this size it is
typically optimal or nearly so. Each member's report shows precisely which
requirements their addition newly covered.

The tool never compresses a team into a single verdict. It reports coverage (the
fraction of requirements addressed), complementarity (one minus the average
pairwise cosine similarity, so higher means members bring more distinct
strengths), overlap (the same average, surfaced separately so near-duplicates are
visible), and interdisciplinarity (the count of distinct disciplines
represented). An overall team-fit figure combines coverage with the
complementarity multiplier, but the components are always shown alongside it,
because a vice president defending a shortlist needs the parts, not just the
conclusion.

## Gap analysis

The same coverage machinery yields something a similarity search cannot: a list
of what is missing. A requirement is a gap for a team when the best member's
normalised strength on it falls below a threshold. Reported at the level of the
whole roster, gaps become capacity gaps: requirements that no one available can
address at all. This is often the most actionable output, because it converts an
RFP into a concrete question about whether to seek an external partner, invite a
colleague from another unit, or treat the gap as a reason not to pursue the
opportunity.

## Bridge scholars and complementary pairs

Two roster-level analyses do not depend on any RFP. A bridge scholar is one whose
vocabulary overlaps many others at a workable distance, neither so little that
there is no shared language nor so much as to be redundant; such people are
natural coordinators and lead investigators. Complementary pairs are ranked by
combined concept coverage in the unit-normalised space, so that a longer CV does
not masquerade as more complementary, with a factor that rewards moderate rather
than extreme overlap. The intuition is that the best pair covers a lot of ground
together while still sharing enough common ground to collaborate at all.

## Collaboration topics

For a team, the tool identifies each member's distinctive concepts (strong for
that member, weak for the others), the concepts a specific pair share as a
collaboration bridge, and the leading themes of the RFP. It then composes topic
suggestions that require combining distinct strengths toward a shared theme.
These are generated from templates and should be read as structured starting
points, not finished proposals. The optional AI layer, when enabled, replaces
these with richer prose while the local version guarantees that the feature works
offline and without any external dependency.

## What the tool does not claim

The scores are instruments for ranking and for structuring a decision. They rest
on what a CV happens to say, weighted by a finite lexicon and a similarity model
that knows nothing of a person's reputation, collegiality, availability, or the
politics of a particular collaboration. The design choice throughout has been to
make the reasoning visible rather than to maximise apparent precision, precisely
so that the people who know the scholars can correct the machine where it is
wrong.
