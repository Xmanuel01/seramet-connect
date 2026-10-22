# POS startup and recovery

Pending startup shows only the existing Seramet logo above the Seramet name.
There is no artificial minimum display time, animation delay, dashboard title,
or visible authentication diagnostics. The protected application uses the same
pending screen while preserving its existing authentication checks.

Device verification is uncached, limited to ten seconds, and cancellable on
unmount. Only one verification request can run per mounted screen. A successful
authoritative response immediately selects employee login or the applicable
device restriction notice. After initial startup, the original split identity
and PIN-keypad layout remains visible for every device state. Failure shows a
compact retry notice inside that layout, alongside administrator, staff account
and restaurant registration access. Retrying does not replace the sign-in page
with a splash or an error-only card. Failure never grants employee
access or restores a previously verified device as current authorization.

Browser regressions cover the branded phone layout, verified-device transition,
503 recovery, retry, real request timeout, revoked-device denial and timeout of
the expired-session fallback. The verified-device transition has a two-second
upper bound after its response is released. Client regressions assert bounded,
uncached verification, cancellation and actual timeout propagation to fetch.
Desktop and narrow-phone screenshots check retained layout and absence of
horizontal overflow. Unverified and revoked devices keep the keypad visible but
disabled; keyboard entry and submission cannot bypass the device check.

Production backend bindings remain a separate prerequisite. This UI correction
must not be reported as successful production sign-in, sales or EOD acceptance.
