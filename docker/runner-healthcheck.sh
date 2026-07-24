#!/bin/sh
set -eu

state_file="${HAPI_HOME:-/root/.hapi}/runner.state.json"

[ -s "$state_file" ] || exit 1

runner_pid="$(
    node -e '
        const fs = require("fs");
        const state = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
        if (!Number.isInteger(state.pid) || state.pid < 1) process.exit(1);
        process.stdout.write(String(state.pid));
    ' "$state_file"
)"

kill -0 "$runner_pid" 2>/dev/null || exit 1

case "$(ps -p "$runner_pid" -o command= 2>/dev/null)" in
    *runner*start-sync*) exit 0 ;;
    *) exit 1 ;;
esac

