/*
 * lexicon.js — domain knowledge for local, LLM-free CV analysis.
 *
 * The lexicon does three jobs:
 *   1. Supplies stopwords so salience scoring is not swamped by boilerplate.
 *   2. Recognises "capability categories" (methods, disciplines, funders,
 *      infrastructure) so a scholar profile is more than a bag of words.
 *   3. Normalises common variants to a canonical form so, e.g.,
 *      "machine-learning", "machine learning" and "ML" collapse together.
 *
 * It is deliberately discipline-spanning: the intended users run a whole
 * university, from humanities to health sciences. Coverage is broad rather
 * than deep; the TF-IDF phrase miner in extract.js does the fine-grained work.
 */
(function (SPF) {
  'use strict';

  // Ordinary English function words plus CV boilerplate that carries no signal.
  var STOPWORDS = ('a an and are as at be by for from has have in into is it its ' +
    'of on or that the to was were will with within without about above after ' +
    'again against all also am any because been before being below between both ' +
    'but cannot could did do does doing down during each few further had he her ' +
    'here hers him his how i if me more most my no nor not now off once only other ' +
    'our out over own same she should so some such than then there these they this ' +
    'those through too under until up very we what when where which while who whom ' +
    'why you your ' +
    // CV boilerplate
    'curriculum vitae resume cv page name email phone address tel fax mobile ' +
    'university college department school institute center centre faculty professor ' +
    'associate assistant adjunct lecturer instructor postdoctoral postdoc student ' +
    'phd msc bsc ms ba bs ma mba dphil degree degrees education experience present ' +
    'current summary objective profile references available request skills interests ' +
    'publications publication journal journals conference conferences proceedings ' +
    'volume issue pages page vol no pp doi isbn eds ed editor editors author authors ' +
    'et al year years month months date dates january february march april may june ' +
    'july august september october november december spring summer fall winter ' +
    'awarded award awards grant grants funding funded project projects work working ' +
    'principal investigator co-investigator pi foundation national endowment institutes selected technical ' +
    'research researcher scholar teaching taught course courses paper papers ' +
    'presented presentation presentations invited talk talks poster posters ' +
    'member membership committee service reviewer reviewing editorial board ' +
    'professional society association societies associations ' +
    'title role position appointment appointments employment ' +
    'city state country usa united states inc llc ltd co corp ' +
    'using used use based approach approaches study studies analysis using new novel ' +
    'results result method methods methodology data ' +
    'one two three four five six seven eight nine ten first second third ' +
    'high low large small significant significantly among between across via ' +
    'edu com org gov net www http https html pdf docx vitae vita ' +
    'including include included e g i e etc ie eg')
    .split(/\s+/);

  // Canonical capability categories. Each entry: canonical term -> list of
  // surface variants (all lowercased, matched as whole phrases).
  // Matching is done by scanning the normalised text for these phrases.
  var METHODS = {
    'machine learning': ['machine learning', 'machine-learning', 'ml', 'statistical learning'],
    'deep learning': ['deep learning', 'neural network', 'neural networks', 'cnn', 'rnn', 'transformer models'],
    'natural language processing': ['natural language processing', 'nlp', 'text mining', 'computational linguistics'],
    'computer vision': ['computer vision', 'image recognition', 'image analysis', 'object detection'],
    'reinforcement learning': ['reinforcement learning'],
    'bayesian methods': ['bayesian', 'bayesian inference', 'markov chain monte carlo', 'mcmc'],
    'statistical modeling': ['statistical modeling', 'statistical modelling', 'regression analysis', 'multilevel modeling', 'structural equation modeling', 'sem'],
    'econometrics': ['econometrics', 'econometric', 'panel data', 'instrumental variables'],
    'optimization': ['optimization', 'optimisation', 'linear programming', 'convex optimization', 'operations research'],
    'simulation': ['simulation', 'agent-based modeling', 'monte carlo', 'discrete event simulation', 'computational modeling'],
    'network analysis': ['network analysis', 'social network analysis', 'graph theory', 'complex networks'],
    'qualitative methods': ['qualitative', 'ethnography', 'ethnographic', 'grounded theory', 'thematic analysis', 'interviews', 'focus groups', 'case study'],
    'survey research': ['survey', 'survey research', 'questionnaire', 'psychometrics'],
    'experimental design': ['experimental design', 'randomized controlled trial', 'rct', 'field experiment', 'laboratory experiment', 'randomized trial'],
    'clinical trials': ['clinical trial', 'clinical trials', 'phase ii', 'phase iii'],
    'systematic review': ['systematic review', 'meta-analysis', 'meta analysis', 'scoping review'],
    'geospatial analysis': ['geospatial', 'gis', 'geographic information systems', 'remote sensing', 'spatial analysis'],
    'bioinformatics': ['bioinformatics', 'genomics', 'sequencing', 'rna-seq', 'proteomics', 'computational biology'],
    'microscopy': ['microscopy', 'electron microscopy', 'confocal', 'imaging'],
    'spectroscopy': ['spectroscopy', 'mass spectrometry', 'nmr', 'chromatography'],
    'fabrication': ['nanofabrication', 'microfabrication', 'cleanroom', 'additive manufacturing', '3d printing'],
    'finite element analysis': ['finite element', 'fea', 'computational fluid dynamics', 'cfd'],
    'field work': ['fieldwork', 'field work', 'field study', 'field data collection'],
    'archival research': ['archival', 'archival research', 'historiography', 'close reading', 'textual analysis'],
    'policy analysis': ['policy analysis', 'program evaluation', 'cost-benefit analysis', 'impact evaluation'],
    'signal processing': ['signal processing', 'time series', 'time-series analysis'],
    'control systems': ['control systems', 'control theory', 'feedback control'],
    'sensor systems': ['sensors', 'sensor networks', 'iot', 'internet of things', 'wearable sensors', 'embedded systems'],
    'cybersecurity methods': ['cybersecurity', 'cryptography', 'penetration testing', 'network security'],
    'human subjects research': ['human subjects', 'irb', 'community-based participatory', 'participatory research']
  };

  var DISCIPLINES = {
    'computer science': ['computer science', 'computing', 'informatics', 'software engineering', 'artificial intelligence', 'data science'],
    'electrical engineering': ['electrical engineering', 'electronics', 'power systems', 'photonics'],
    'mechanical engineering': ['mechanical engineering', 'thermodynamics', 'robotics', 'mechatronics'],
    'civil engineering': ['civil engineering', 'structural engineering', 'transportation engineering', 'geotechnical'],
    'materials science': ['materials science', 'materials engineering', 'nanomaterials', 'polymers', 'composites'],
    'chemical engineering': ['chemical engineering', 'catalysis', 'process engineering'],
    'biomedical engineering': ['biomedical engineering', 'bioengineering', 'biomechanics', 'medical devices'],
    'physics': ['physics', 'condensed matter', 'quantum', 'astrophysics', 'optics'],
    'chemistry': ['chemistry', 'organic chemistry', 'inorganic chemistry', 'physical chemistry', 'biochemistry'],
    'biology': ['biology', 'molecular biology', 'cell biology', 'microbiology', 'ecology', 'neuroscience'],
    'environmental science': ['environmental science', 'climate', 'sustainability', 'hydrology', 'ecosystem', 'environmental engineering'],
    'earth science': ['geology', 'geosciences', 'seismology', 'geophysics', 'atmospheric science'],
    'mathematics': ['mathematics', 'applied mathematics', 'statistics', 'probability', 'topology'],
    'public health': ['public health', 'epidemiology', 'health policy', 'biostatistics', 'global health', 'health disparities'],
    'medicine': ['medicine', 'clinical', 'oncology', 'cardiology', 'immunology', 'pharmacology', 'nursing'],
    'psychology': ['psychology', 'cognitive science', 'behavioral', 'developmental psychology', 'clinical psychology'],
    'economics': ['economics', 'finance', 'labor economics', 'behavioral economics', 'development economics'],
    'business': ['business administration', 'marketing', 'entrepreneurship', 'organizational behavior', 'accounting', 'supply chain', 'operations management', 'strategic management'],
    'sociology': ['sociology', 'social stratification', 'demography', 'criminology'],
    'political science': ['political science', 'public policy', 'international relations', 'governance', 'public administration'],
    'education': ['pedagogy', 'curriculum', 'learning sciences', 'stem education', 'educational technology', 'higher education', 'science education'],
    'communication': ['communication', 'media studies', 'journalism', 'digital media'],
    'anthropology': ['anthropology', 'archaeology', 'cultural anthropology'],
    'history': ['history', 'historical', 'historiography'],
    'philosophy': ['philosophy', 'ethics', 'bioethics', 'logic'],
    'linguistics': ['linguistics', 'phonology', 'syntax', 'sociolinguistics'],
    'literature': ['literature', 'literary studies', 'comparative literature', 'rhetoric'],
    'law': ['law', 'legal studies', 'jurisprudence', 'intellectual property law'],
    'art and design': ['fine arts', 'graphic design', 'industrial design', 'architecture', 'music', 'visual arts', 'performing arts'],
    'hospitality': ['hospitality', 'tourism', 'gaming', 'event management'],
    'social work': ['social work', 'human services', 'gerontology', 'family studies']
  };

  // Funding agencies and program vocabulary. Recognising these lets the tool
  // read a scholar's funding track record and read an RFP's sponsor.
  var FUNDERS = {
    'NSF': ['nsf', 'national science foundation'],
    'NIH': ['nih', 'national institutes of health', 'r01', 'r21', 'u01', 'p01', 'k award'],
    'DOE': ['department of energy', 'doe'],
    'DOD': ['department of defense', 'dod', 'darpa', 'onr', 'afosr', 'army research office'],
    'NASA': ['nasa'],
    'NEH': ['national endowment for the humanities', 'neh'],
    'NEA': ['national endowment for the arts'],
    'USDA': ['usda', 'department of agriculture'],
    'EPA': ['environmental protection agency', 'epa'],
    'CDC': ['cdc', 'centers for disease control'],
    'private foundation': ['gates foundation', 'sloan foundation', 'macarthur', 'mellon foundation', 'ford foundation', 'robert wood johnson', 'templeton'],
    'industry': ['google', 'microsoft', 'intel', 'ibm', 'nvidia', 'industry partner', 'sbir', 'sttr'],
    'state and local': ['state of nevada', 'nevada system', 'governor', 'regional', 'municipal']
  };

  // Infrastructure, resources and outputs a collaborator might bring.
  var INFRASTRUCTURE = {
    'high-performance computing': ['high-performance computing', 'hpc', 'supercomputing', 'cluster computing', 'gpu cluster'],
    'laboratory facility': ['laboratory', 'wet lab', 'cleanroom', 'core facility', 'testbed'],
    'field station': ['field station', 'observatory', 'research vessel'],
    'clinical access': ['clinical site', 'patient population', 'hospital partnership', 'biobank', 'registry'],
    'data assets': ['dataset', 'longitudinal data', 'administrative data', 'proprietary data', 'corpus'],
    'community partnerships': ['community partner', 'school district', 'nonprofit partner', 'stakeholder network'],
    'instrumentation': ['instrument', 'spectrometer', 'microscope', 'sequencer', 'fabrication facility']
  };

  // Cross-cutting themes funders increasingly reward; useful for RFP matching
  // and for surfacing broader-impact angles.
  var THEMES = {
    'artificial intelligence': ['artificial intelligence', 'ai', 'machine learning', 'foundation models', 'generative ai'],
    'climate and sustainability': ['climate change', 'sustainability', 'decarbonization', 'renewable energy', 'resilience'],
    'health equity': ['health equity', 'health disparities', 'underserved', 'social determinants'],
    'water': ['water resources', 'water security', 'water sustainability', 'drought', 'watershed', 'water treatment', 'desalination', 'water reuse', 'wastewater'],
    'indigenous knowledge': ['indigenous knowledge', 'traditional ecological knowledge', 'indigenous communities'],
    'energy': ['energy storage', 'grid', 'solar', 'battery', 'hydrogen'],
    'quantum': ['quantum computing', 'quantum information', 'quantum sensing'],
    'workforce development': ['workforce development', 'broadening participation', 'stem education', 'reskilling'],
    'smart cities': ['smart city', 'smart cities', 'urban systems', 'transportation systems'],
    'biotechnology': ['biotechnology', 'synthetic biology', 'gene therapy', 'vaccine'],
    'cybersecurity': ['cybersecurity', 'privacy', 'trustworthy computing'],
    'aging': ['aging', 'gerontology', 'alzheimer', 'dementia', 'longevity'],
    'mental health': ['mental health', 'behavioral health', 'substance use', 'addiction']
  };

  // Section headers used to segment a CV so we can weight, e.g., recent
  // grants more heavily than an old teaching list.
  var SECTION_HEADERS = {
    grants: ['grants', 'funding', 'sponsored research', 'research funding', 'external funding', 'awards and grants', 'contracts and grants'],
    publications: ['publications', 'peer-reviewed publications', 'journal articles', 'refereed publications', 'selected publications'],
    research: ['research', 'research interests', 'research areas', 'research statement', 'areas of expertise', 'research experience', 'research focus'],
    teaching: ['teaching', 'teaching experience', 'courses taught', 'teaching interests'],
    education: ['education', 'academic training', 'degrees'],
    experience: ['experience', 'appointments', 'academic appointments', 'professional experience', 'employment'],
    service: ['service', 'professional service', 'editorial', 'committees'],
    skills: ['skills', 'technical skills', 'expertise', 'competencies', 'methods', 'techniques']
  };

  // Build a fast lookup: variant phrase -> {canonical, category}. Longer
  // phrases are matched before shorter ones by the extractor.
  function buildIndex() {
    var index = [];
    function add(dict, category) {
      Object.keys(dict).forEach(function (canonical) {
        dict[canonical].forEach(function (variant) {
          index.push({ variant: variant, canonical: canonical, category: category });
        });
      });
    }
    add(METHODS, 'method');
    add(DISCIPLINES, 'discipline');
    add(FUNDERS, 'funder');
    add(INFRASTRUCTURE, 'infrastructure');
    add(THEMES, 'theme');
    // Match longer variants first to prefer specific phrases.
    index.sort(function (a, b) { return b.variant.length - a.variant.length; });
    return index;
  }

  SPF.lexicon = {
    STOPWORDS: STOPWORDS,
    STOPSET: (function () { var s = Object.create(null); STOPWORDS.forEach(function (w) { s[w] = true; }); return s; })(),
    METHODS: METHODS,
    DISCIPLINES: DISCIPLINES,
    FUNDERS: FUNDERS,
    INFRASTRUCTURE: INFRASTRUCTURE,
    THEMES: THEMES,
    SECTION_HEADERS: SECTION_HEADERS,
    index: buildIndex()
  };
})(typeof window !== 'undefined' ? (window.SPF = window.SPF || {}) : (globalThis.SPF = globalThis.SPF || {}));
