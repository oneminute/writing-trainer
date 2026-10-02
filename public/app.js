const exercises = [
  { prompt:"我通常在放学后做作业。", focus:"Present Simple + frequency", hints:["usually 表示习惯，用一般现在时。","主语 I 后面用 do。","I + usually + do my homework + after school."], model:"I usually do my homework after school." },
  { prompt:"我妹妹每天乘公共汽车去学校。", focus:"Third-person singular", hints:["my sister 相当于 she。","第三人称单数：take → takes。","My sister + takes the bus + to school + every day."], model:"My sister takes the bus to school every day." },
  { prompt:"我们昨天在科学课上做了一个实验。", focus:"Past Simple", hints:["yesterday 表示过去。","do 的过去式是 did。","We + did an experiment + in science class + yesterday."], model:"We did an experiment in science class yesterday." },
  { prompt:"老师昨天没有给我们家庭作业。", focus:"didn't + base verb", hints:["这是过去时否定句。","didn't 后必须用动词原形。","The teacher + didn't give + us homework + yesterday."], model:"The teacher didn't give us homework yesterday." },
  { prompt:"明天我们要在数学课上参加一个测验。", focus:"Future with will", hints:["tomorrow 表示将来。","will 后使用动词原形。","We + will + take a quiz + in math class + tomorrow."], model:"We will take a quiz in math class tomorrow." },
  { prompt:"这两本书都很有趣。", focus:"Plural subject + be", hints:["books 是复数。","复数主语搭配 are。","These two books + are + interesting."], model:"These two books are interesting." },
  { prompt:"我的朋友喜欢科学，因为他喜欢做实验。", focus:"because + third-person", hints:["because 后面说明原因。","my friend 和 he 都是第三人称单数。","My friend likes science because he likes doing experiments."], model:"My friend likes science because he likes doing experiments." },
  { prompt:"当老师提问时，我会先认真听。", focus:"When clause", hints:["when 表示“当……的时候”。","teacher 是第三人称单数：ask → asks。","When the teacher asks a question, I listen carefully."], model:"When the teacher asks a question, I listen carefully first." },
  { prompt:"我昨晚很累，所以我很早就睡觉了。", focus:"Past tense + so", hints:["last night 表示过去。","am → was；go → went。","I was tired last night, so I went to bed early."], model:"I was tired last night, so I went to bed early." },
  { prompt:"如果我不懂一个单词，我会查它的意思。", focus:"If clause", hints:["if 表示“如果”。","描述通常做法，两部分都用一般现在时。","If I don't understand a word, I look up its meaning."], model:"If I don't understand a word, I look up its meaning." },
  { prompt:"我的Chromebook现在不在书包里。", focus:"Singular + be negative", hints:["Chromebook 是单数。","否定使用 is not / isn't。","My Chromebook isn't in my backpack now."], model:"My Chromebook isn't in my backpack now." },
  { prompt:"上周我读了一本很有趣的书，而且我把它推荐给了朋友。", focus:"Past tense + pronoun", hints:["last week 表示过去。","recommend → recommended。","I read an interesting book and recommended it to my friend."], model:"Last week, I read an interesting book and recommended it to my friend." }
];

let index = 0;
let hintLevel = 0;
const solved = new Set();
const $ = id => document.getElementById(id);

function render() {
  const q = exercises[index];
  $("focus").textContent = q.focus;
  $("prompt").textContent = q.prompt;
  $("progressText").textContent = `${index + 1} / ${exercises.length}`;
  $("progressBar").style.width = `${((index + 1) / exercises.length) * 100}%`;
  $("status").textContent = solved.has(index) ? "Solved ✓" : "";
  $("score").textContent = `Solved ${solved.size} / ${exercises.length}`;
  $("answer").value = "";
  $("result").className = "result hidden";
  $("hint").className = "notice hint hidden";
  $("model").className = "notice model hidden";
  hintLevel = 0;
  $("answer").focus();
}

function metric(label, value) {
  return `<div class="metric">${label}<b>${value === "ok" ? "✓" : value === "not_applicable" ? "—" : "△"}</b></div>`;
}

async function checkAnswer() {
  const answer = $("answer").value.trim();
  if (!answer) return;
  const q = exercises[index];
  $("loading").classList.remove("hidden");
  $("result").className = "result hidden";
  $("checkBtn").disabled = true;
  try {
    const response = await fetch("/api/check", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: q.prompt, answer, grammarFocus: q.focus, modelAnswer: q.model })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Check failed");
    if (data.correct) solved.add(index);
    $("result").className = `result ${data.correct ? "ok" : "bad"}`;
    $("result").innerHTML = `
      <strong>${data.correct ? "✓ Good sentence" : "Revise this sentence"}</strong>
      <div class="grid">
        ${metric("Meaning", data.meaning)}
        ${metric("Grammar", data.grammar)}
        ${metric("Tense", data.tense)}
        ${metric("Capital", data.capitalization)}
        ${metric("Punctuation", data.punctuation)}
      </div>
      <div><b>Feedback:</b> ${data.feedback}</div>
      <div><b>Suggestion:</b> ${data.suggestion}</div>
      <div><b>Better sentence:</b> ${data.betterSentence}</div>
    `;
    $("status").textContent = solved.has(index) ? "Solved ✓" : "";
    $("score").textContent = `Solved ${solved.size} / ${exercises.length}`;
  } catch (error) {
    $("result").className = "result bad";
    $("result").textContent = error.message;
  } finally {
    $("loading").classList.add("hidden");
    $("checkBtn").disabled = false;
  }
}

$("checkBtn").onclick = checkAnswer;
$("hintBtn").onclick = () => {
  hintLevel = Math.min(hintLevel + 1, 3);
  $("hint").classList.remove("hidden");
  $("hint").innerHTML = `<b>Hint ${hintLevel}:</b> ${exercises[index].hints[hintLevel - 1]}`;
};
$("modelBtn").onclick = () => {
  $("model").classList.remove("hidden");
  $("model").innerHTML = `<b>One model answer:</b> ${exercises[index].model}<br><span class="muted">Other natural answers can also be correct.</span>`;
};
$("clearBtn").onclick = () => { $("answer").value = ""; $("answer").focus(); };
$("prevBtn").onclick = () => { if (index > 0) { index--; render(); } };
$("nextBtn").onclick = () => { if (index < exercises.length - 1) { index++; render(); } };
$("answer").addEventListener("keydown", event => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    checkAnswer();
  }
});
render();
