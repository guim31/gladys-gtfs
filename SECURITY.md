# Security policy

## Reporting a vulnerability

Please do **not** report a security problem in a public issue, pull request or
forum post.

Report it privately through GitHub instead: open the **Security** tab of this
repository, then **Report a vulnerability**.

No such button? Private reporting is not enabled yet: open an issue that only
asks the maintainers for a private contact, without any detail of the problem,
and send the report there.

Include, when you can:

- the version of the integration and of Gladys;
- what an attacker can do, and the steps to reproduce it;
- the log lines that help (remove tokens, passwords and addresses first).

The fix ships as a new version of the integration, and the advisory is
published once users can update.

## Supported versions

Only the latest release receives security fixes: update the integration from
Gladys before reporting a problem.

## Scope

In scope: the code of this repository and the Docker image it publishes.

The integration needs no account and no password. It stores under `/data`:

- `watch.json`: the networks (name and feed addresses) and stops you watch,
  and the identifiers of the traffic alerts already announced;
- `gtfs-<network>.zip`: the public timetable of each network, downloaded once
  a day.

A GTFS or GTFS-RT address you type for a network outside the catalog may hold
a key in its query string: it is kept in `watch.json` and in the parameters of
the Gladys devices (to rebuild the watch list if `/data` is lost), and never
written to the logs, which only name the host.

It reads the position of your Gladys houses (`location`) only to sort the
stops by distance; the position is never stored nor sent anywhere. Its only
network traffic is outbound HTTPS: `transport.data.gouv.fr` (the catalog and
its realtime proxy), `www.data.gouv.fr` (redirecting to the publishers of the
timetables), and the realtime feeds of your networks. Every download has a
timeout and a size limit.

Out of scope: Gladys Assistant itself (see its
[security policy](https://github.com/GladysAssistant/Gladys/security/policy)),
and the open data services the integration reads.
