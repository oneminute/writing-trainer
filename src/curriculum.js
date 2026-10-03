export const SKILLS = [
  { id:"sentence_structure", stage:1, name:"Basic sentence structure", description:"Subject + verb + object/complement" },
  { id:"be_verbs", stage:1, name:"Be verbs", description:"am / is / are / was / were" },
  { id:"pronouns", stage:1, name:"Pronouns", description:"I / me / he / him / they / them" },
  { id:"singular_plural", stage:1, name:"Singular & plural", description:"noun number and agreement" },
  { id:"articles", stage:1, name:"Articles", description:"a / an / the" },
  { id:"present_simple", stage:2, name:"Present simple", description:"habits and facts" },
  { id:"third_person", stage:2, name:"Third-person singular", description:"he/she/it + verb-s" },
  { id:"frequency", stage:2, name:"Frequency words", description:"usually / often / sometimes / always" },
  { id:"past_simple", stage:3, name:"Past simple", description:"regular and irregular past verbs" },
  { id:"did_auxiliary", stage:3, name:"Did / didn't", description:"did + base verb" },
  { id:"future", stage:4, name:"Future", description:"will + base verb" },
  { id:"modals", stage:4, name:"Modal verbs", description:"can / should / must + base verb" },
  { id:"coordination", stage:5, name:"and / but / so", description:"connect related ideas" },
  { id:"because", stage:5, name:"because", description:"give a reason" },
  { id:"time_clauses", stage:6, name:"Time clauses", description:"when / before / after" },
  { id:"if_clause", stage:6, name:"If clauses", description:"basic conditions" },
  { id:"wh_clauses", stage:7, name:"Wh- clauses", description:"what / how / where / why" },
  { id:"relative_clauses", stage:8, name:"Relative clauses", description:"who / which / that" },
  { id:"sentence_expansion", stage:9, name:"Sentence expansion", description:"add time, place, reason and detail" },
  { id:"connected_writing", stage:10, name:"Connected writing", description:"write 3 connected sentences" },
  { id:"paragraph", stage:11, name:"Paragraph writing", description:"topic + details + closing" },
  { id:"school_writing", stage:12, name:"School writing", description:"independent grade-level writing" }
];

export const skillMap = Object.fromEntries(SKILLS.map(s => [s.id, s]));

export function statusFromMastery(score, attempts) {
  if (!attempts) return "Not started";
  if (score >= 85 && attempts >= 4) return "Mastered";
  if (score >= 75 && attempts >= 2) return "Stable";
  if (score >= 45) return "Improving";
  return "Learning";
}

export function nextReviewDays(streak) {
  return [1, 3, 7, 14][Math.min(Math.max(streak, 0), 3)];
}
