- fix pattern capture when using alternate rule sets: captured patterns should be annotated with the rule set they were captured from, so that they can be correctly applied when the rule set is switched
- the "fill" drawing tool is misaligned when using hex grids
- in hex grids, the pattern tool's preview display uses the wrong grid type (square instead of hex) and is also in the wrong position
- in hex grids, the line tool's preview display uses the wrong grid type (square instead of hex) and is also in the wrong position
- when switching rule sets in the settings menu during the normal game mode, we need to resize the board in order to force the grid to be replaced. fix this.
- we need to support various pattern to represent cities; the level designer should pick city patterns from the zoo (this is purely a visual change, it doesn't affect the game logic)

- pattern editor needs to allow user to specify ruleset. currently the editor sets the ruleset to the default, which is broken for editing exotic patterns

- Euclidean rules (eg Bugs) appears wrong when used in level customizer - need to use settings panel, switch to a different ruleset, then back to bugs, and it appears correctly
- Exotic rules (like relativistic) do not seem to work for the enemy the same way

- TCA, Time-integrated, and Lightcone rulesets do not work for the enemy paint type

We need to streamline the gameplay ui:

- create a seperate file to handle a time control. It should compactly allow for the selection of time on a relatively logrithmic scale, including pause and up to 64x speed. It should have step-forward controls as well as incremental speedup and slowdown controls. It should also have a display of the current time and speed. It should be designed to be fairly compact.
- "zoo" should be only displayed if the pattern button is selected, as it is mainly a pattern selection tool. It should be hidden when the line or fill tools are selected, as it is not relevant to those tools.
- settings/help/guide/reset/exit should be moved to a separate menu, as they are not directly related to the gameplay and can be accessed from a different screen. This will help declutter the main gameplay interface and make it more focused on the core mechanics of the game.
- "clear defenses" and "capture pattern" should be treated as abilities, even though they are always available. They should be displayed in the same area as the other abilities, and should have the same visual design as the other abilities, to create a more cohesive and consistent user interface.

- abilities should be a dropup menu instead of giving each option its own button. This will help declutter the interface and make it more compact, while still allowing the player to easily access all of their abilities when needed. The last-used ability should be displayed on the main interface for quick access, while the rest of the abilities can be accessed through the dropup cta.
- the menu button should open the menu oriented to the upper left, not the lower right. that is, the menu options panel's south edge should be aligned with the menu button's north edge, and the menu options panel's east edge should be aligned with the menu button's east edge. this should be the case for all dropups, including the abilities menu
- There is currently a bugged settings button (without a label) on the main toolbar. it should be in the menu only.

- the pattern selection should
- the button should open the options panel oriented to the upper left, not the lower right. that is, the panel's south edge should be aligned with the button's north edge, and the panel's east edge should be aligned with the button's east edge.
