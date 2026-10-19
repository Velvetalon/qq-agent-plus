printf '%s\n' 'Archived snapshot only; execution blocked'
exit 64
set -eu
umask 077
[ "$(id -un)" = ubuntu ]
[ "$(id -u)" = 1000 ]
[ "$(readlink -f "/REVIEW_REQUIRED_PRIVATE_MAINTENANCE_DIRECTORY")" = "/REVIEW_REQUIRED_PRIVATE_MAINTENANCE_DIRECTORY" ]
[ ! -e "/REVIEW_REQUIRED_PRIVATE_MAINTENANCE_DIRECTORY/validation-91beebbcc3" ]
mkdir -m 700 "/REVIEW_REQUIRED_PRIVATE_MAINTENANCE_DIRECTORY/validation-91beebbcc3"
printf "VALIDATION_DIRECTORY_READY\n"
