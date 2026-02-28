---
name: bareos
description: Manage Bareos data backups. Use for checking backup status, running jobs, restoring files, and managing volumes/clients/schedules.
allowed-tools: Bash(bconsole:*)
---

# Bareos Backup Management

You have access to `bconsole`, the Bareos command-line console, to manage the backup system. The Director runs on the host at `host.docker.internal:9101`.

## Running bconsole Commands

Use `echo "command" | bconsole` for single commands:

```bash
echo "status director" | bconsole
echo "list jobs" | bconsole
```

For multiple commands, use a heredoc:

```bash
bconsole <<'EOF'
status director
list clients
EOF
```

## Common Operations

### Status & Monitoring

| Command | What it does |
|---------|-------------|
| `status director` | Running jobs, scheduled jobs, recently completed |
| `status client=bareos-fd` | File daemon status on a specific client |
| `status storage=File` | Storage daemon and device status |
| `status scheduler` | Upcoming scheduled jobs |
| `status all` | Status of all components |
| `messages` | Pending console messages |

### Listing Information

| Command | What it does |
|---------|-------------|
| `list jobs` | Recent jobs (short format) |
| `list jobs limit=20` | Last 20 jobs |
| `list jobtotals` | Summary statistics |
| `list clients` | All configured backup clients |
| `list volumes` | All backup volumes |
| `list pools` | All storage pools |
| `list files jobid=N` | Files backed up in job N |
| `list nextvol job=Name` | Predict next volume for a job |
| `llist jobid=N` | Full details of a specific job (long format) |

### Running Backups

| Command | What it does |
|---------|-------------|
| `run job=Name level=Full yes` | Run full backup immediately |
| `run job=Name level=Incremental yes` | Run incremental backup |
| `run job=Name level=Differential yes` | Run differential backup |
| `estimate job=Name` | Preview what would be backed up |
| `estimate job=Name listing` | List all files that would be backed up |

### Restoring Files

Interactive restore (prompts for file selection):

```bash
bconsole <<'EOF'
restore client=bareos-fd where=/tmp/bareos-restore select all done yes
EOF
```

Restore with specific options:

```bash
bconsole <<'EOF'
restore client=bareos-fd where=/tmp/bareos-restore current select all done yes
EOF
```

Restore parameters:
- `where=/path` — restore to alternate location
- `replace=always|ifnewer|ifolder|never` — file replacement policy
- `restoreclient=OtherClient-fd` — restore to a different client
- `current` — use most recent backup

### Job Management

| Command | What it does |
|---------|-------------|
| `cancel jobid=N` | Cancel a running job |
| `cancel all` | Cancel all running jobs |
| `rerun jobid=N` | Re-run a failed job |
| `enable job=Name` | Enable scheduled job |
| `disable job=Name` | Disable scheduled job |

### Volume Management

| Command | What it does |
|---------|-------------|
| `label storage=File volume=Vol-0001 pool=Full` | Label new volume |
| `update volume=Name volstatus=Used` | Change volume status |
| `update volume=Name pool=Full` | Move volume to pool |
| `delete volume=Name pool=Full` | Remove volume from catalog |
| `prune volume pool=Full all yes` | Remove expired data |
| `purge volume=Name` | Force purge (ignores retention) |
| `truncate volstatus=Purged storage=File` | Reclaim disk space |

### Configuration

| Command | What it does |
|---------|-------------|
| `show jobs` | Show job definitions |
| `show clients` | Show client definitions |
| `show pools` | Show pool definitions |
| `show storages` | Show storage definitions |
| `configure add job name=NewJob ...` | Add resource at runtime |
| `configure export client=Name-fd` | Generate client config |
| `reload` | Reload Director config from disk |

### Diagnostics

| Command | What it does |
|---------|-------------|
| `version` | Director version |
| `setdebug level=100 trace=1 dir` | Enable debug on Director |
| `setdebug level=0 trace=0 dir` | Disable debug |
| `setbandwidth limit=1000 client=Name-fd` | Throttle bandwidth (KB/s) |

## Command Syntax Notes

- Commands can be abbreviated: `st dir` = `status director`
- Range syntax: `jobid=5,10-15,20`
- Max line length: 511 characters
- Add `yes` at the end to skip confirmation prompts

## Architecture

```
bconsole (container) ---> port 9101 ---> Director (host)
Director ---> port 9102 ---> File Daemon (clients)
Director ---> port 9103 ---> Storage Daemon
File Daemon ---> port 9103 ---> Storage Daemon (data)
```
