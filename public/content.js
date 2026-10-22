// content.js: every piece of copy and every deck the app shows.
// Plain data only (no functions, no DOM). app.js fills the {placeholders}.
// The copy rules live in test/content.test.mjs and run on every string here.
//
// Placeholders used in this file:
//   {n}           a number; what it counts is noted on each string
//   {name}        a chapter's one-word name, CHAPTERS[i].short
//   {day}         day of the current chapter, starting at 1
//   {date}        a formatted date, for example "Mon 13 Oct"
//   {month}       a formatted month name, for example "October"
//   {next}        the chapter number after the one being finished
//   {current}     the current chapter number
//   {pages}       a page count already formatted with COPY.countPages or COPY.countPagesOne
//   {mornings}    a morning count already formatted with COPY.countMornings or COPY.countMorningsOne
//   {artistDate}  COPY.checkinArtistDone or COPY.checkinArtistNone
//   {time}        time left on the timer, for example "12:30"
//   {version}     the app version string

// The twelve chapters, in the book's order. `about` and `themes` are written
// fresh (no quotes, no close paraphrase, no task lists). `note` is a heads-up
// worth reading before the week starts, or null.
export const CHAPTERS = [
  {
    num: 1,
    title: "Recovering a Sense of Safety",
    short: "Safety",
    about:
      "Feeling safe enough to make things at all. It looks at the critic in your head and the old beliefs that show up as soon as you try. It also covers people who stay close to other people's art without making their own.",
    themes: ["The critic in your head", "Old negative beliefs", "Affirmations", "Shadow artists"],
    note: "The book's opening chapters explain the two basic tools, so read those before this one.",
  },
  {
    num: 2,
    title: "Recovering a Sense of Identity",
    short: "Identity",
    about:
      "Guarding a new, still shaky sense of yourself as a creative person. It covers people who stir up drama and eat your time, and the skeptical voice that says all of this is a bit silly. It also asks you to pay closer attention to the small things in your days.",
    themes: ["Crazymakers", "Draining people", "Skepticism", "Paying attention"],
    note: null,
  },
  {
    num: 3,
    title: "Recovering a Sense of Power",
    short: "Power",
    about:
      "Reading anger as a sign of what you want and where your limits are. It also covers lucky coincidences and the shame that can follow showing your work. Criticism comes up too, along with the reminder that progress is uneven.",
    themes: ["Anger", "Coincidences", "Shame", "Criticism", "Uneven progress"],
    note: null,
  },
  {
    num: 4,
    title: "Recovering a Sense of Integrity",
    short: "Integrity",
    about:
      "Being honest about what you actually like and want, now that the pages make it harder to dodge. Old interests and dreams you shelved tend to come back up. It's also the week without reading, and plenty of people cut scrolling too.",
    themes: ["Honest changes", "Buried dreams", "Reading deprivation"],
    note: "This week asks you to stop reading for seven days, so plan around work reading before you start.",
  },
  {
    num: 5,
    title: "Recovering a Sense of Possibility",
    short: "Possibility",
    about:
      "Noticing the limits you put on what you're allowed to want. It covers being so busy being good to everyone that your own work never gets a turn. It also looks at the small pleasures you don't let yourself have.",
    themes: ["Limits", "The virtue trap", "Forbidden joys", "Wishes"],
    note: null,
  },
  {
    num: 6,
    title: "Recovering a Sense of Abundance",
    short: "Abundance",
    about:
      "Money, and the beliefs about it that hold your creative life back. It asks you to look at where your money actually goes and to make room for small luxuries that matter to you. It leans on the idea of a generous creator, which you can read however suits you.",
    themes: ["Money beliefs", "Small luxuries", "Where money goes", "A generous creator"],
    note: "This week asks you to keep track of what you spend, so have a pen or a note ready from day one.",
  },
  {
    num: 7,
    title: "Recovering a Sense of Connection",
    short: "Connection",
    about:
      "Making things by listening for them and taking down what comes. It deals with perfectionism and risk, and with jealousy as a pointer to what you want.",
    themes: ["Listening", "Perfectionism", "Risk", "Jealousy"],
    note: null,
  },
  {
    num: 8,
    title: "Recovering a Sense of Strength",
    short: "Strength",
    about:
      "Getting through creative setbacks without giving up. It covers grieving losses like rejections and looking for what a loss opens up. It also takes on the worry that it's too late to start, and keeps coming back to small, steady steps.",
    themes: ["Setbacks", "Loss", "Age and time", "Small steps"],
    note: null,
  },
  {
    num: 9,
    title: "Recovering a Sense of Compassion",
    short: "Compassion",
    about:
      "Treating your blocks with some patience. The chapter looks at the fear underneath them, and at how enthusiasm and play keep the work going. It also covers the urge to back off right when something starts going well.",
    themes: ["Fear", "Enthusiasm", "Creative U-turns", "Getting through blocks"],
    note: null,
  },
  {
    num: 10,
    title: "Recovering a Sense of Self-Protection",
    short: "Self-Protection",
    about:
      "Spotting the habits you use to block yourself, like overworking or staying busy all the time. It also covers dry spells when the pages feel pointless, chasing recognition, and comparing yourself with others.",
    themes: ["Self-blocking habits", "Workaholism", "Dry spells", "Fame", "Competition"],
    note: null,
  },
  {
    num: 11,
    title: "Recovering a Sense of Autonomy",
    short: "Autonomy",
    about:
      "Accepting yourself as someone who makes things, on your own terms. It covers handling success without losing your footing and getting out of your head through walking or sport. It also suggests setting up a small corner at home for your creative life.",
    themes: ["Acceptance", "Success", "Movement", "A corner of your own"],
    note: null,
  },
  {
    num: 12,
    title: "Recovering a Sense of Faith",
    short: "Faith",
    about:
      "Trusting your work when you can't see where it's going. Ideas need quiet time before they show, and simple jobs with your hands can help them along. It also looks at the pull to stall or turn back right when things start moving.",
    themes: ["Trust", "Mystery", "Play", "Escape velocity"],
    note: null,
  },
];

// First lines to copy onto a blank page. Ids are stable (state.seen keeps them).
export const STARTERS = [
  // body
  { id: "body-now", text: "Right now my body feels..." },
  { id: "slept", text: "Last night I slept..." },
  { id: "woke-up", text: "The first thing on my mind when I woke up was..." },
  { id: "physically", text: "Physically, this morning I..." },
  { id: "hungry", text: "I'm hungry for..." },
  { id: "room", text: "The room I'm sitting in..." },
  { id: "outside", text: "Outside the window right now..." },
  // avoidance
  { id: "avoiding", text: "Right now I'm avoiding..." },
  { id: "putting-off", text: "The thing I keep putting off is..." },
  { id: "dont-want", text: "What I really don't want to write about is..." },
  { id: "phone-escape", text: "The thing I grab my phone to get away from is..." },
  { id: "acting-fine", text: "I keep acting like I'm fine with..." },
  // wants
  { id: "want-week", text: "What I actually want this week is..." },
  { id: "more-time", text: "I wish I had more time for..." },
  { id: "secret-want", text: "Something I want and haven't told anyone is..." },
  { id: "like-to-try", text: "I'd like to try..." },
  { id: "admit", text: "Nobody will read this, so I can admit..." },
  { id: "less-of", text: "This week I want less of..." },
  // yesterday
  { id: "yesterday", text: "Yesterday I..." },
  { id: "best-yesterday", text: "The best part of yesterday was..." },
  { id: "still-on-mind", text: "Something from yesterday that's still on my mind..." },
  { id: "last-night", text: "Last night I kept thinking about..." },
  // people
  { id: "thinking-of", text: "Someone I keep thinking about is..." },
  { id: "owe-message", text: "I owe a message to..." },
  { id: "conversation", text: "A conversation that stuck with me..." },
  { id: "nerves", text: "Someone who's been getting on my nerves is..." },
  { id: "miss", text: "I miss..." },
  { id: "unsaid", text: "Something I haven't said to someone yet..." },
  // fear
  { id: "scares-week", text: "What scares me about this week is..." },
  { id: "worst-case", text: "The worst case I keep picturing is..." },
  { id: "nervous", text: "I'm nervous about..." },
  { id: "people-think", text: "I'm worried people will think..." },
  // small pleasures
  { id: "small-good", text: "Something small that was good lately..." },
  { id: "lost-time", text: "The last time I lost track of time was..." },
  { id: "smelled-good", text: "Something that smelled good recently..." },
  { id: "meal", text: "A meal I'd happily eat again is..." },
  { id: "laughed", text: "The last thing that made me laugh was..." },
  // money
  { id: "money-now", text: "When I think about money right now..." },
  { id: "money-spent", text: "Something I spent money on and don't regret..." },
  { id: "money-avoid", text: "The money thing I keep not looking at is..." },
  { id: "hundred-euros", text: "With an extra hundred euros I'd..." },
  // work
  { id: "work-head", text: "The work thing taking up the most room in my head is..." },
  { id: "today-need", text: "Today I need to..." },
  { id: "circling", text: "The project I keep circling around is..." },
  { id: "nobody-watching", text: "What I'd make with nobody watching..." },
  // the critic
  { id: "critic-says", text: "The critic in my head keeps saying..." },
  { id: "pointless", text: "The part of me that thinks this is pointless says..." },
  { id: "excuse", text: "The excuse I used most this week was..." },
  { id: "not-good-enough", text: "I'm not good enough to..." },
  // anything
  { id: "dont-know", text: "I don't know what to write, so..." },
  { id: "honestly", text: "Honestly, this morning..." },
  { id: "on-repeat", text: "What's been on repeat in my head is..." },
  { id: "coming-back", text: "I keep coming back to..." },
  { id: "changed-mind", text: "Something I changed my mind about..." },
  { id: "pleased", text: "Something I did lately that I'm quietly pleased about..." },
];

// Artist date ideas: solo, about two hours, play and noticing.
// kind: "out" | "make" | "look" | "listen" | "wander" | "home"
// cost: "free" (nothing), "cheap" (up to about 10 euros), "some" (more than that)
export const IDEAS = [
  // out
  { id: "flea-five", text: "Take five euros to a flea market and come back with the oddest thing you can find.", kind: "out", cost: "cheap" },
  { id: "film-poster", text: "See an afternoon film on your own, picked only by its poster.", kind: "out", cost: "some" },
  { id: "library-magazines", text: "Spend an afternoon in the library reading magazines you'd never buy.", kind: "out", cost: "free" },
  { id: "greenhouse", text: "Walk slowly through a botanical garden greenhouse on a grey day.", kind: "out", cost: "some" },
  { id: "market-fruit", text: "Go to a market and buy one fruit you've never tasted, then eat it slowly.", kind: "out", cost: "cheap" },
  { id: "ice-rink", text: "Go skating at an ice rink and let yourself be bad at it for an hour.", kind: "out", cost: "some" },
  { id: "secondhand", text: "Spend an hour in a big second-hand shop picking things up and putting them back.", kind: "out", cost: "free" },
  { id: "art-supplies", text: "Go to an art supply shop and buy one material you've never used before.", kind: "out", cost: "cheap" },
  { id: "pool-float", text: "Go to the pool at a quiet hour and spend part of it just floating.", kind: "out", cost: "cheap" },
  { id: "open-studios", text: "Go to an open studio day and look around other people's workspaces.", kind: "out", cost: "free" },
  // look
  { id: "one-painting", text: "Choose one painting in a museum and look at it for a full twenty minutes.", kind: "look", cost: "some" },
  { id: "painted-hands", text: "Walk through a museum looking only at the hands in the paintings.", kind: "look", cost: "some" },
  { id: "station", text: "Sit in a big train station for an hour and watch people arrive and leave.", kind: "look", cost: "free" },
  { id: "high-sunset", text: "Find the highest spot in town you can reach for free and watch the sunset.", kind: "look", cost: "free" },
  { id: "dark-sky", text: "On a clear night, get away from the streetlights and look up for a while.", kind: "look", cost: "free" },
  { id: "photo-every-ten", text: "Take one photo every ten minutes for two hours, of whatever is in front of you.", kind: "look", cost: "free" },
  { id: "old-street-photo", text: "Find an old photo of your street in the local archive and stand where it was taken.", kind: "look", cost: "free" },
  { id: "city-farm", text: "Visit a city farm and watch one animal for twenty minutes.", kind: "look", cost: "free" },
  { id: "water-birds", text: "Sit by the water with a cheap bird guide and learn three birds by sight.", kind: "look", cost: "cheap" },
  { id: "doors", text: "Walk around an old part of town and photograph only doors and doorbells.", kind: "look", cost: "free" },
  // listen
  { id: "new-genre", text: "Listen to a genre you know nothing about for an hour, without skipping.", kind: "listen", cost: "free" },
  { id: "record-shop", text: "Spend an hour in a record shop flipping through sleeves and listening to a few.", kind: "listen", cost: "free" },
  { id: "carillon", text: "Find out when the local carillon plays and listen from a bench nearby.", kind: "listen", cost: "free" },
  { id: "organ", text: "Go to a lunchtime organ concert in an old church and stay to the end.", kind: "listen", cost: "cheap" },
  { id: "student-recital", text: "Go to a free student recital at a music school and sit wherever you like.", kind: "listen", cost: "free" },
  { id: "jazz-jam", text: "Go to a jazz jam session, order one drink and sit near the back.", kind: "listen", cost: "cheap" },
  { id: "sound-walk", text: "Record ten minutes of sound on a walk and listen back to it at home.", kind: "listen", cost: "free" },
  { id: "radio-play", text: "Listen to a radio play in the dark with a pot of tea.", kind: "listen", cost: "free" },
  { id: "rain", text: "Find a sheltered spot during a rain shower and just listen to it.", kind: "listen", cost: "free" },
  { id: "market-calls", text: "Stand at the edge of a busy market and listen to the stallholders calling out.", kind: "listen", cost: "free" },
  // wander
  { id: "stopping-train", text: "Take a stopping train to a station you've never got off at and walk around.", kind: "wander", cost: "some" },
  { id: "dune-paths", text: "Walk the dune paths with no plan and turn back when you feel like it.", kind: "wander", cost: "free" },
  { id: "rough-sea", text: "Go to the beach in rough weather and watch the sea for as long as you like.", kind: "wander", cost: "free" },
  { id: "waterline", text: "Walk the beach along the waterline and pick up anything worth a second look.", kind: "wander", cost: "free" },
  { id: "cycle-lost", text: "Cycle somewhere new and get a little lost on purpose.", kind: "wander", cost: "free" },
  { id: "river-out", text: "Follow a river or canal out of town for an hour, then wander back.", kind: "wander", cost: "free" },
  { id: "passed-through", text: "Walk around a part of town you've only ever passed through.", kind: "wander", cost: "free" },
  { id: "woods-rain", text: "Walk in the woods just after rain and notice what you can smell.", kind: "wander", cost: "free" },
  { id: "polder-dusk", text: "Walk out into the polder at dusk and watch the light go over the fields.", kind: "wander", cost: "free" },
  { id: "end-of-line", text: "Ride a tram or bus to the end of the line and explore on foot.", kind: "wander", cost: "cheap" },
  { id: "left-right", text: "Leave the house and alternate left and right at every corner for an hour.", kind: "wander", cost: "free" },
  { id: "dusk-lights", text: "Walk through town at dusk and watch the streets change as the lights come on.", kind: "wander", cost: "free" },
  { id: "small-ferry", text: "Take a small ferry across a river and explore whatever is on the other side.", kind: "wander", cost: "cheap" },
  { id: "courtyard", text: "Find an old almshouse courtyard in town and sit there quietly for a while.", kind: "wander", cost: "free" },
  // make
  { id: "sketchbook", text: "Buy a cheap sketchbook and fill five pages with quick drawings of anything.", kind: "make", cost: "cheap" },
  { id: "air-clay", text: "Get some air-dry clay and make something without deciding what it is first.", kind: "make", cost: "cheap" },
  { id: "cafe-drawing", text: "Sit in a café and draw the cups, chairs and coats around you.", kind: "make", cost: "cheap" },
  { id: "found-things", text: "Collect small things on a walk and arrange them on a table at home.", kind: "make", cost: "free" },
  { id: "same-tree", text: "Get a cheap set of paints and paint the same tree three times.", kind: "make", cost: "cheap" },
  { id: "tiny-book", text: "Fold a sheet of paper into a tiny book and fill every page with drawings.", kind: "make", cost: "free" },
  { id: "cardboard-room", text: "Build a cardboard model of a room you'd like to live in.", kind: "make", cost: "free" },
  { id: "potato-stamp", text: "Carve a stamp out of a potato and print patterns on old paper.", kind: "make", cost: "free" },
  { id: "instrument", text: "Play around on a cheap instrument with no lesson and no song in mind.", kind: "make", cost: "cheap" },
  { id: "blind-hand", text: "Draw your own hand twenty times without looking at the paper.", kind: "make", cost: "free" },
  // home, good for dark winter evenings
  { id: "candle-album", text: "Switch off the big light, light a candle and play one album all the way through.", kind: "home", cost: "free" },
  { id: "paint-to-music", text: "Put on an album and paint along to it, one sheet of paper per track.", kind: "home", cost: "cheap" },
  { id: "lamplight-room", text: "Draw the room you're in by lamplight, in pen, without erasing anything.", kind: "home", cost: "free" },
  { id: "memory-place", text: "Draw a place you used to know from memory, then compare it with an old photo.", kind: "home", cost: "free" },
  { id: "jigsaw", text: "Do a jigsaw puzzle with music on and your phone in another room.", kind: "home", cost: "cheap" },
  { id: "letter", text: "Write a letter by hand to someone you miss and decide later whether to send it.", kind: "home", cost: "free" },
  { id: "tea-tasting", text: "Brew three different teas and taste them side by side, slowly.", kind: "home", cost: "cheap" },
  { id: "old-film", text: "Watch an old black-and-white film with the lights off and your phone away.", kind: "home", cost: "free" },
  { id: "new-cuisine", text: "Cook something from a cuisine you've never tried, slowly, with music on.", kind: "home", cost: "cheap" },
  { id: "bread", text: "Bake bread by hand and notice how the dough changes as you knead it.", kind: "home", cost: "cheap" },
  { id: "window-watch", text: "Sit by the window with the lights off and watch the street for an hour.", kind: "home", cost: "free" },
  { id: "origami", text: "Learn one origami figure and fold a dozen of them in different papers.", kind: "home", cost: "cheap" },
  { id: "poems-aloud", text: "Borrow a poetry book from the library and read a few poems aloud at home.", kind: "home", cost: "free" },
];

// Re-entry line on Today, picked by core.reentry(state, today).bucket.
// {n} = days since the last pages. "never" has no gap, so no {n}.
export const REENTRY = {
  days: [
    "Last pages: {n} days ago. One page today and you're back in.",
    "{n} days since your last pages. One page today picks it back up.",
  ],
  week: [
    "Last pages: {n} days ago. One page today and you're back in.",
    "Your last pages were {n} days ago. One page today counts as coming back.",
  ],
  weeks: [
    "Last pages: {n} days ago. Nothing to catch up on, just one page today.",
    "It's been {n} days since your last pages. One page today is plenty to restart.",
  ],
  never: [
    "The count starts with your first page. One today is plenty.",
    "Pages get logged by date from here on. Start with one today.",
  ],
};

// Pick-up card, shown when the current chapter has no start date (after a
// long gap, after moving over from the old app, or on a fresh start).
export const PICKUP = {
  title: "Pick up at week {n}", // {n} suggested chapter
  line: "Start it from today, or choose a different week. Anything you logged before stays.",
  lineMoved: "Your ticks from the old app are saved with their weeks. Start here from today, or choose a different week.", // after a v1 migration
  start: "Start week {n} today", // {n} suggested chapter
  choose: "Choose another week",
  chooseTitle: "Which week?",
  chooseLine: "The week you choose starts today.",
  freshTitle: "Start at week 1", // fresh start, nothing logged anywhere yet
  freshLine: "Begin with week 1 today, or choose the week you're already on.",
};

// Shown once today's three pages are in. Rotate; the first is the default.
export const DONE_LINES = [
  "Three pages. Done for today.",
  "That's today's pages done.",
  "Today's three pages are on paper.",
  "Done. Whatever ended up on the pages counts.",
  "Three of three for today.",
  "Pages done. Enjoy the rest of your day.",
];

// Check-in sheet when finishing a chapter.
// intro placeholders:
//   {pages}       COPY.countPages ("{n} pages") or COPY.countPagesOne, already filled
//   {mornings}    COPY.countMornings ("{n} mornings") or COPY.countMorningsOne, already filled
//   {artistDate}  COPY.checkinArtistDone or COPY.checkinArtistNone
// With 0 pages use COPY.checkinIntroMornings (old-app mornings only) or
// COPY.checkinIntroEmpty (nothing logged) instead. Both questions are optional.
export const CHECKIN = {
  intro: "{pages} over {mornings} this chapter. {artistDate}",
  questions: [
    {
      id: "lineUp",
      q: "Did anything line up this week?",
      hint: "A coincidence, or a door opening right when you needed it.",
    },
    {
      id: "matters",
      q: "What came up that matters?",
      hint: "From the pages or anywhere else. A line or two is enough.",
    },
  ],
};

// UI strings by screen. Placeholders are noted next to each string.
export const COPY = {
  // App and navigation
  appName: "Artist's Way",
  navToday: "Today",
  navBook: "Book",
  navKept: "Kept",
  settings: "Settings",
  close: "Close",
  cancel: "Cancel",
  done: "Done",
  save: "Save",
  edit: "Edit",

  // Dates. The app builds "Thursday 22 October" and "22 Oct" from these.
  weekdayNames: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"],
  monthNames: [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  ],
  monthShort: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],

  // Today: chapter line and moving on
  chapterLine: "Week {n} · {name}", // {n} chapter number, {name} CHAPTERS[n - 1].short
  chapterDay: "Day {day}", // {day} day of the current chapter
  moveLine: "Day {day} of week {n}. Move on when you're ready.", // {day} day of chapter, {n} chapter number
  moveLineLast: "Day {day} of week 12. Finish the book when you're ready.", // {day} day of chapter
  migratedNote: "Your ticks and notes from the old app came across with their weeks.",

  // Today: morning pages
  morningPages: "Morning pages",
  morningSub: "Three pages, longhand, before anything else.",
  startWriting: "Start writing",
  pagesPartial: "{n} of 3", // {n} pages written today, 1 or 2
  pagesHint: "Mark each page as you finish it.",
  pageSlot: "Page {n}", // screen reader label, {n} 1 to 3
  pageSlotDone: "Page {n}, written", // screen reader label, {n} 1 to 3
  keepPrompt: "Anything worth keeping?",
  keepPlaceholder: "One line from today's pages",
  keepSave: "Keep",
  keepSaved: "Kept.",

  // Today: this week strip and the backfill sheet
  weekTitle: "This week",
  weekRange: "{date} to {date}", // first {date} the Monday (day number only within one month), second {date} the Sunday
  weekDays: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
  dayAria: "{date}, {n} of 3 pages", // screen reader label, {date} formatted date, {n} 0 to 3
  backfillTitle: "Pages on {date}", // {date} formatted date
  backfillTitleToday: "Pages today",
  backfillSub: "How many pages did you write?",
  backfillNone: "None",

  // Today: month count, count-up only
  monthCount: "{n} pages in {month}", // {n} pages this month (2 or more), {month} month name
  monthCountOne: "1 page in {month}", // {month} month name
  monthEmpty: "Pages you write this month add up here.",

  // Artist date card, on Today and on the chapter page
  artistDate: "Artist date",
  artistSub: "Two hours, alone, doing something that feeds you.",
  another: "Another",
  planThis: "Plan this one",
  ownPlan: "Write your own",
  planPlaceholder: "What you'll do and when",
  planSave: "Save plan",
  artistPlanned: "This week's plan",
  didIt: "Did it",
  change: "Change",
  clearPlan: "Clear plan",
  artistDoneAsk: "Done. How was it?",
  artistNotePlaceholder: "A few words about it",
  artistNoteSave: "Save",
  artistDoneOn: "Done on {date}", // {date} formatted date
  artistUndo: "Not done yet",
  ideaKinds: {
    out: "Going out",
    make: "Making",
    look: "Looking",
    listen: "Listening",
    wander: "Wandering",
    home: "At home",
  },
  ideaCosts: {
    free: "Free",
    cheap: "Cheap",
    some: "Costs a bit",
  },

  // Writing overlay
  writingLine: "Phone face down. A bell rings at the end.",
  writingLineNoBell: "Phone face down. The bell is off in Settings.",
  minutesOption: "{n} min", // {n} 20, 25 or 30
  timerStart: "Start",
  timerPause: "Pause",
  timerResume: "Resume",
  timerReset: "Reset",
  timerPaused: "Paused",
  timerLeft: "{time} left", // screen reader label, {time} like "12:30"
  timerEnded: "Time's up. Finish the page you're on, or stop here.",
  screenOn: "The screen stays on while the timer runs.",
  stuckLine: "Can't start? Copy this line onto the page.",
  anotherLine: "Another line",
  writingPagesHint: "Tap each page as you finish it.",
  rainToggle: "Rain",
  writingDone: "Done",
  updateWaiting: "An update is ready. It loads once the timer stops.",

  // Book: contents
  bookTitle: "The book",
  bookSub: "Twelve chapters. Stay on each one as long as you need.",
  weekLabel: "Week {n}", // {n} chapter number
  statusCurrent: "Now",
  statusDone: "Done",
  statusUpcoming: "Not started",
  startedOn: "Started {date}", // {date} formatted date
  startedOnDay: "Started {date} · day {day}", // {date} formatted date, {day} day of the current chapter
  countPages: "{n} pages", // {n} 0 or 2 and up
  countPagesOne: "1 page",
  countMornings: "{n} mornings", // {n} 0 or 2 and up
  countMorningsOne: "1 morning",
  artistDateDone: "Artist date done",

  // Book: chapter page
  themesHeading: "In this chapter",
  noteHeading: "Before you start",
  readLabel: "Read the chapter",
  statsHeading: "Logged",
  legacyMornings: "{n} mornings ticked in the old app", // {n} 2 and up
  legacyMorningsOne: "1 morning ticked in the old app",
  legacyArtistDate: "Artist date ticked in the old app",
  checkinHeading: "Check-in",
  startThisWeek: "Start this week",
  startConfirm: "Start week {n} from today? Week {current} keeps everything you logged.", // {n} chosen chapter, {current} current chapter
  startConfirmYes: "Start week {n} today", // {n} chosen chapter
  startConfirmNo: "Not now",
  restartThisWeek: "Do this week again",
  restartConfirm: "Start week {n} again from today? Your notes, answers and artist date stay.", // {n} chapter number
  allChapters: "All chapters",

  // Check-in sheet (the intro line and the questions are in CHECKIN)
  checkinTitle: "Week {n} check-in", // {n} chapter being finished
  checkinIntroMornings: "{mornings} this chapter. {artistDate}", // see CHECKIN for both placeholders
  checkinIntroEmpty: "Nothing logged here this chapter, which happens. {artistDate}", // {artistDate} see CHECKIN
  checkinArtistDone: "Artist date done.",
  checkinArtistNone: "No artist date this time.",
  checkinOptional: "Both questions are optional.",
  checkinPlaceholder: "A line or two",
  checkinNext: "Start week {next}", // {next} chapter number after this one
  checkinFinishLast: "Finish week 12",
  checkinNotYet: "Not yet",
  courseDone: "All twelve chapters done. Keep the pages going as long as they help.",

  // Kept
  keptTitle: "Kept",
  keptSub: "Lines you kept from your pages, newest first.",
  keptEmptyTitle: "Nothing kept yet",
  keptEmpty: "After your pages there's room for one line worth keeping. Those lines collect here with their dates.",

  // Settings
  settingsTitle: "Settings",
  themeLabel: "Theme",
  themeSystem: "System",
  themeLight: "Light",
  themeDark: "Dark",
  timerLabel: "Timer length",
  bellLabel: "Bell at the end",
  rainLabel: "Rain sound while writing",
  accentLabel: "Colour",
  accentFollow: "Follow the chapter",
  accentFollowSub: "Each week has its own colour.",
  version: "Version {version}", // {version} app version

  // Settings: backup and restore
  backupTitle: "Backup",
  backupSub: "Everything is stored on this phone only. Keep a copy somewhere else now and then.",
  backupCopy: "Copy backup",
  backupDownload: "Download file",
  backupRestore: "Restore from file",
  backupCopied: "Backup copied. Paste it into a note or an email to yourself.",
  backupCopyFailed: "Couldn't copy. Try Download file instead.",
  backupDownloaded: "Backup file downloaded.",
  restoreConfirm: "Replace everything on this phone with this backup?",
  restoreConfirmDated: "Replace everything on this phone with the backup from {date}?", // {date} the backup's exportedAt, formatted
  restoreYes: "Replace",
  restoreNo: "Cancel",
  restoreDone: "Backup restored.",
  restoreDoneOld: "Old app data restored. Choose the week to carry on from.",
  restoreUnchanged: "Nothing on this phone was changed.",
  // Keys match the codes core.importBackup returns, plus `file` for a file
  // the browser couldn't open at all.
  restoreErrors: {
    file: "Couldn't open that file. Try again, or choose another one.",
    empty: "That file is empty.",
    unreadable: "That file couldn't be read. Choose a backup file saved from this app.",
    unknown: "That file isn't a backup from this app.",
    wrongApp: "That backup is from a different app.",
    newer: "That backup is from a newer version of this app. Update the app and try again.",
    damaged: "That backup is incomplete, so nothing was restored.",
  },

  // Settings: start over
  startOver: "Start over",
  startOverConfirm: "This deletes all pages, kept lines, artist dates and check-ins on this phone. It can't be undone, so download a backup first to be safe.",
  startOverYes: "Delete everything",
  startOverNo: "Keep everything",
  startOverDone: "Everything is cleared.",

  // Errors
  storageError: "Saving isn't working in this browser, so changes may be lost. Private browsing can cause this.",
};
