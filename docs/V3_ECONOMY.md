# V3 Economy and Monetization

## Rules

- Competitive power is never sold.
- Direct purchase is the paid-store default.
- Paid random cases are excluded from launch.
- Earn-only cases disclose odds and duplicate conversion.
- Premium-currency prices show an understandable real-money equivalent.
- Server owns balances, inventory and purchase transactions.

## Currencies

- Coins: match and contract rewards.
- Mastery Shards: long-term skill progression rewards.
- Premium currency: introduced only with payment infrastructure.
- Event Tokens: temporary and clearly expiring.

## Free earning routes

- Tutorial completion.
- First match of day.
- Match completion.
- Daily/weekly contracts.
- Mastery milestones.
- Ranked season rewards.
- Events.
- Free battle-pass track.

## Paid catalog

- Avatar skins.
- Ball skins.
- Trails.
- Deflect effects.
- Goal effects.
- MVP animations.
- Emotes.
- Profile banners and frames.
- Announcer packs.
- Lobby poses.

No paid item changes collision, damage, speed, cooldown, stamina or visibility.

## Battle pass gate

Do not launch a full battle pass until retention and content production are
credible. Initial structure:

- Eight weeks.
- Fifty tiers.
- Free reward every tier.
- Premium cosmetic additions.
- Catch-up XP.
- No energy limit.

## Required commerce work

- Payment provider.
- Regional pricing.
- Tax/VAT handling.
- Refund path.
- Parental/minor protections.
- Purchase receipt.
- Transaction idempotency.
- Customer support tooling.

## Implemented foundation

- Signed provider webhook events are required before premium currency is granted.
- Premium grants are catalog-priced, transaction-idempotent and server-owned.
- Payment events and telemetry remain separate: suspicious gameplay never grants
  or removes currency automatically.
