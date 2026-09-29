# Recipe and Production Model

## Recipe identity and versions

A recipe identifies a sellable menu item or a produced inventory item. Its versions hold effective dates, yield, unit, packaging cost, configured production overhead and components. Creating a new version does not overwrite historical versions.

Sale-date theoretical usage resolves the version effective at that date. This preserves historical cost and consumption when a recipe changes.

## Components

Each component references exactly one of:

- an inventory item; or
- a sub-recipe.

The component stores quantity, unit, optional waste factor and station. Unit conversion is validated against the referenced inventory item. Sub-recipes are costed in proportion to their yield. A graph check rejects direct and indirect circular dependencies.

## Recipe cost

```text
component cost
  = normalized base quantity
  x current weighted-average base-unit cost

recipe batch cost
  = sum(component cost including configured waste factor)
  + configured packaging cost
  + configured production overhead

theoretical portion cost
  = recipe batch cost / configured yield
```

Overhead is included only when configured; Seramet does not invent it.

## Production batch

Completion records planned quantity, actual output, station/employee and an idempotency key. It atomically appends:

- `PRODUCTION_INPUT` movements for raw ingredients or prepared sub-recipes; and
- one `PRODUCTION_OUTPUT` movement for the finished inventory item.

The batch stores expected and actual yield plus variance. Repeating the completion command returns the existing result and creates no duplicate movements.

## Yield and process loss

Expected process loss belongs in component waste factors or recipe configuration. Actual yield is measured from completed production. A short yield is not automatically labelled theft or wastage; it is retained as evidence for variance analysis.

## Theoretical consumption

For a sold menu item:

```text
sold quantity
x component quantity per recipe yield
= theoretical ingredient quantity
```

The calculation includes the dated active recipe and any configured modifier recipes. Missing recipes or costs reduce the quality state rather than producing fake values.

## Prep planning

Prep recommendations combine deterministic demand, prepared quantity and configured safety buffer. They remain recommendations with station and due-time context. Customer KDS tickets and production batches remain separate status models.
