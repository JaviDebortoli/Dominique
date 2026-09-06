# Delta for storefront-browsing

**Type**: Delta — modifies the existing `storefront-browsing` capability. Adds a
dedicated requirement for how the header presents category navigation; today
only "Home Page Layout" implies it ("navigation ... matching the mockup") and no
requirement pins its presentation or dismissal behavior. "Header Cart Entry
Point" is unchanged.

## ADDED Requirements

### Requirement: Header Category Navigation

The storefront header MUST present category navigation as a single collapsed
control, not a persistently expanded row. The control MUST be closed by default
on every page load. When opened it MUST reveal one link per category, each
navigating to `/categoria/{slug}`, using the same category set and labels as the
rest of the storefront. It MUST close on `Escape`, on a pointer interaction
outside the control, and when one of its category links is selected. When there
are no categories, no category-navigation control MUST render. This requirement
governs the header only; home-page category tiles and other category entry
points are out of its scope and MUST remain unaffected.

#### Scenario: Category navigation is collapsed by default

- GIVEN a customer opens any storefront page
- WHEN the header renders
- THEN the category links MUST NOT be visible or in the accessibility tree
- AND a single labeled control (e.g. "Categorías") MUST be present, marked as collapsed

#### Scenario: Opening the control reveals the category links

- GIVEN the header shows the collapsed category control
- AND categories "Vestidos" and "Accesorios" exist
- WHEN the customer activates the control
- THEN a link to `/categoria/vestidos` and a link to `/categoria/accesorios` MUST become available
- AND the control MUST be marked as expanded

#### Scenario: Selecting a category closes the control and navigates

- GIVEN the category control is open
- WHEN the customer clicks the "Vestidos" link
- THEN the system MUST navigate to `/categoria/vestidos`
- AND the control MUST return to its collapsed state

#### Scenario: Escape and outside click dismiss the control

- GIVEN the category control is open
- WHEN the customer presses `Escape` OR clicks outside the control
- THEN the control MUST return to its collapsed state
- AND no navigation MUST occur

#### Scenario: No categories means no control

- GIVEN there are zero categories
- WHEN the header renders
- THEN no category-navigation control MUST appear in the header

#### Scenario: Home-page category entry points are unaffected

- GIVEN the home page renders its own category tiles/sections
- WHEN this change ships
- THEN those tiles MUST still be present and link to their category pages, independent of the header control
