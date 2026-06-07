- fix pattern capture when using alternate rule sets: captured patterns should be annotated with the rule set they were captured from, so that they can be correctly applied when the rule set is switched
- the "fill" drawing tool is misaligned when using hex grids
- in hex grids, the pattern tool's preview display uses the wrong grid type (square instead of hex) and is also in the wrong position
- in hex grids, the line tool's preview display uses the wrong grid type (square instead of hex) and is also in the wrong position
- when switching rule sets in the settings menu during the normal game mode, we need to resize the board in order to force the grid to be replaced. fix this.
- we need to support various pattern to represent cities; the level designer should pick city patterns from the zoo (this is purely a visual change, it doesn't affect the game logic)

- pattern editor needs to allow user to specify ruleset. currently the editor sets the ruleset to the default, which is broken for editing exotic patterns

- Euclidean rules (eg Bugs) appears wrong when used in level customizer - need to use settings panel, switch to a different ruleset, then back to bugs, and it appears correctly
- Exotic rules (like relativistic) do not seem to work for the enemy the same way

- New feature: Asymmetric Enemy and friendly rulesets
  - Level designer needs settings for enemy ruleset
  - Review and fix support for alternate rulesets
- Transpose the settings panel's max age matrix: the region types should be rows, not columns

-
- If a cell is placed by a enemy base or a missile spawner, it should act as immortal until it turns off at least once after spawning. This is to prevent needed anchor points from being expired.
- TCA, Time-integrated, and Lightcone rulesets do not work for the enemy paint type
