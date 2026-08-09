# Soundness escape hatches

`as`, angle-bracket type assertions, non-null `!`, `@ts-ignore`, and `@ts-expect-error` are not universally forbidden by TypeScriptAssay. Policy must choose `forbid` or `allow-with-receipt` independently for assertions, non-null assertions, and directives. Both treatments emit TSA-B03 evidence; `forbid` makes it blocking and `allow-with-receipt` makes it a visible warning.

This is evidence about source syntax. It does not infer why an escape hatch was justified. That remains review work.
