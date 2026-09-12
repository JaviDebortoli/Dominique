# Delta for admin-console

**Type**: Delta — modifies the existing `admin-console` capability. Adds a required payment-method choice to the in-person "Vender 1" sale action, an "Anular" action for a recorded `Sale`, and a new revenue report page with day/date-range filtering plus nav entry.

## ADDED Requirements

### Requirement: In-Person Sale Payment Method Choice

`CajaRowActions`' "Vender 1" action MUST require staff to select a payment method — "Efectivo" (CASH) or "Transferencia" (TRANSFER) — before the sale request is submitted. The UI MUST block submission until one method is selected; there is no default/pre-selected method.

#### Scenario: Staff selects a payment method before selling

- GIVEN staff open the payment-method choice for a "Vender 1" action
- WHEN they select "Efectivo" and confirm
- THEN the POST request MUST include `paymentMethod: CASH` and the sale MUST proceed

#### Scenario: Submission blocked without a payment-method selection

- GIVEN staff open the payment-method choice for a "Vender 1" action
- WHEN they attempt to confirm without selecting either option
- THEN the UI MUST block submission and MUST NOT send the sale request

### Requirement: Sale Void Action Visibility

The admin console MUST surface an "Anular" action for a recorded `Sale`, and MUST hide or disable that action once the `Sale` is already voided.

#### Scenario: Anular action available for an active sale

- GIVEN a `Sale` has not been voided
- WHEN staff view it in the admin console
- THEN an "Anular" action MUST be available for it

#### Scenario: Anular action unavailable for an already-voided sale

- GIVEN a `Sale` has already been voided
- WHEN staff view it in the admin console
- THEN the "Anular" action MUST be hidden or disabled, preventing a second void attempt from the UI

### Requirement: Revenue Report Page and Navigation

The admin console navigation MUST include a link to a new revenue report page under `/admin/(console)`. The page MUST let staff choose between a single-day filter and a date-range filter and MUST render the aggregated totals per the `sales-revenue` capability's aggregation rules.

#### Scenario: Report reachable from the nav

- GIVEN staff are logged into the admin console
- WHEN they view the console navigation
- THEN a link to the revenue report page MUST be present

#### Scenario: Report offers both filter modes

- GIVEN staff open the revenue report page
- WHEN they choose a filter mode
- THEN they MUST be able to select either a single day or a start/end date range before the report renders totals
