# Graduation Group Sash Selection Design

New groups choose one of two policies in the existing group builder: a fixed sash for every student, or each student choosing a sash. The fixed policy stores its selected sash type in the existing `defaultConfiguration` JSON and uses the group's existing sash color. Existing groups without the policy remain in per-student mode. The public student wizard reflects the policy, while the server applies the same policy authoritatively when creating a group order. No schema, route, booking, or unrelated graduation behavior changes are needed.

The public student registration form no longer asks for a university number or sends one in newly generated payloads. Historical server records remain intact.
