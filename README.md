# DinCharya – Daily Task Planner

Most to-do apps only store a list. You still have to decide what to do first and when.
DinCharya does that part for you: type your tasks in plain words and it builds a
time-blocked plan for the rest of your day, around your college hours.

**Live demo:** _add your Netlify / GitHub Pages link here_

## Features

- **Plain-language input** – `DBMS assignment 2h by fri !high` is understood as a 2-hour, high-priority task due Friday. It also handles Hinglish words like `kal`, `aaj` and `roz`.
- **Auto scheduling** – fills your free time with tasks, skipping busy hours (college, coaching, etc.)
- **Smart priority** – deadline, priority, daily habits and how often a task was skipped decide the order
- **Carry-over** – unfinished tasks move to the next day automatically and get a priority boost
- **Recurring tasks** – daily and weekly tasks reset on their own
- **Reminders** – browser notification 5 minutes before each block
- **Calendar export** – download today's plan as an `.ics` file for Google Calendar or your phone calendar
- **Stats** – tasks done today, streak, planned vs free time, late tasks
- **Backup / restore** as JSON, dark mode, works on mobile, works offline

## Tech used

HTML, CSS and plain JavaScript (no frameworks). Data is saved in the browser with `localStorage`.
There is no server and no paid API, so it costs nothing to run.

## How it works

1. **Parser (`parseTask`)** – regular expressions pick out the duration, deadline, priority and repeat from the sentence. Whatever text is left becomes the task title.
2. **Scoring (`score`)**
   `score = priority×10 + deadline bonus (late +40, today +30, tomorrow +20, ≤3 days +10) + daily +15 + skipped×5 + quick-task +3`
3. **Scheduler (`buildPlan`)** – a greedy *first-fit* algorithm:
   - free slots = (day start → day end) minus busy hours minus time already passed
   - sort pending tasks by score, highest first
   - put each task in the first free slot big enough for it, and leave a short break after it
   - tasks that don't fit are listed, with a warning if any of them is due today
4. **Day rollover (`startOfDayCheck`)** – on the first open of a new day: completed one-time tasks are removed, daily and weekly tasks are reset, and unfinished tasks get `skipped + 1`

## Run it

Open `index.html` in any browser. That's all.

## Put it online for free (2 minutes)

**Netlify Drop:** go to app.netlify.com/drop and drag the `dincharya` folder onto the page. You get a live link straight away.

**GitHub Pages:** create a repo, upload the 3 files, then go to Settings → Pages → Branch: main → Save.

## Future scope

- Splitting long tasks across more than one free slot
- Sync between devices using a free backend such as Firebase
- Learning how long you really take on each kind of task and adjusting the estimates
