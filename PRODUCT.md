# PRODUCT.md

## Register

`brand` for `/site` (landing, pricing). `product` for the app itself (`index.html`, `stats.html`, `live.html`, `admin.html`, `watch.html`).

## Product purpose

Handball-Tracker is a browser-based match tracker for handball. A coach opens it on the sideline and records what happens as it happens: shots, goals, assists, saves, cards, two-minute suspensions, substitutions, attacks. Everything is minute-stamped. Matches save to a season history, aggregate into player and team statistics, and can be broadcast live to a share link so people not in the hall can follow along.

It replaces the paper match sheet and the spreadsheet that gets rebuilt every season.

## Users

**Primary: the coach.** Coaches and assistants at amateur and semi-pro clubs. They are standing, holding a phone or tablet, in a loud sports hall, with roughly two seconds of attention per action. They are not analysts and did not ask for a data platform. They want the thing they already do on paper to survive the drive home.

**Secondary: the club.** Board members and technical committees buying for several teams at once. They care about consistency across teams, season-long records that outlast a departing coach, and whether it is worth the money.

**Tertiary: the follower.** Parents, partners, and supporters watching the live broadcast link from elsewhere. They never sign up. They must never see a login wall.

## Brand voice

Three words: **precise, unhurried, sideline-literate.**

- Speak like a coach who knows the sport, not like a SaaS company that has heard of it. "Two-minute suspension", "seven metre", "throw-off", "GK save rate" are correct usage, not jargon to be avoided.
- State what the product does. Do not sell the feeling of winning.
- Numbers are the voice. When there is a real figure, show it instead of describing it.
- Never breathless. No "revolutionise", "unleash", "game-changing", "supercharge".

## Anti-references

Things this brand is explicitly not:

- **Generic sports-tech neon.** Dark background plus glowing green plus a stadium photo plus "ELEVATE YOUR GAME". The palette is close to this by inheritance, so every other decision must pull away from it.
- **Enterprise analytics SaaS.** Gradient mesh hero, three identical feature cards with rounded icon squares, logo wall of clubs we do not have, "trusted by teams worldwide".
- **Editorial-typographic minimalism.** Display serif, ruled columns, small tracked mono labels, no imagery. A currently saturated lane and the wrong register for a sideline tool.
- **Fitness-app maximalism.** Aggressive diagonals, motion blur, hype copy, exclamation marks.

## Strategic principles

1. **The product demonstrates itself.** Real screenshots and a real recording, never illustrated abstractions of an interface. The site is allowed to behave like the app.
2. **Yellow is currency.** `#e8ff00` is spent on the primary call to action and on live numbers. Nowhere else. If everything is yellow, the trial button is not.
3. **The clock is the spine.** Handball is played against a running clock and recorded on a minute-stamped protocol. That structure organises the site, and it is the one thing a template cannot reproduce.
4. **No invented facts.** No fabricated testimonials, no club logos, no user counts, no prices that have not been decided. Empty is better than false.
5. **Zero seam.** A visitor who clicks "Start free trial" should not notice they changed products.

## Current commercial state

Two plan types exist in the codebase: `personal` and `club`. Access is granted by invite code. Trial accounts are capped by sign-in count. Prices are **not yet decided**, so the pricing page explains what each tier includes and asks for contact rather than publishing figures. Do not add numbers until they are real.
