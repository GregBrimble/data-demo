#! /bin/bash
#
# This script uploads the edge chat demo to your Cloudflare Workers account.
#
# This is a temporary hack needed until we add Durable Objects support to Wrangler. Once Wrangler
# support exists, this script can probably go away.
#
# On first run, this script will ask for configuration, create the Durable Object namespace bindings,
# and generate metadata.json. On subsequent runs it will just update the script from source code.

set -euo pipefail

if ! which curl >/dev/null; then
  echo "$0: please install curl" >&2
  exit 1
fi

if ! which jq >/dev/null; then
  echo "$0: please install jq" >&2
  exit 1
fi

# If credentials.conf doesn't exist, prompt for the values and generate it.
if [ -e credentials.conf ]; then
  source credentials.conf
else
  echo -n "Please create a Cloudflare Auth Token with the 'Edit Cloudflare Workers' template."
  echo -n "Auth Token: "
  read AUTH_TOKEN
  echo -n "Cloudflare account ID (32 hex digits, found on the right sidebar of the Workers dashboard): "
  read ACCOUNT_ID

  SCRIPT_NAME=data-demo

  cat > credentials.conf << __EOF__
ACCOUNT_ID=$ACCOUNT_ID
AUTH_TOKEN=$AUTH_TOKEN
SCRIPT_NAME=$SCRIPT_NAME
__EOF__

  chmod 600 credentials.conf

  echo "Wrote credentials.conf with these values."
fi

# curl_api performs a curl command passing the appropriate authorization headers, and parses the
# JSON response for errors. In case of errors, exit. Otherwise, write just the result part to
# stdout.
curl_api() {
  RESULT=$(curl -s -H "Authorization: Bearer $AUTH_TOKEN" "$@")
  if [ $(echo "$RESULT" | jq .success) = true ]; then
    echo "$RESULT" | jq .result
    return 0
  else
    echo "API ERROR:" >&2
    echo "$RESULT" >&2
    return 1
  fi
}

# Let's verify the credentials work by listing Workers scripts and Durable Object namespaces. If
# either of these requests error then we're certainly not going to be able to continue.
echo "Checking if credentials can access Workers..."
curl_api https://api.cloudflare.com/client/v4/accounts/$ACCOUNT_ID/workers/scripts >/dev/null
echo "Checking if credentials can access Durable Objects..."
curl_api https://api.cloudflare.com/client/v4/accounts/$ACCOUNT_ID/workers/durable_objects/namespaces >/dev/null
echo "Credentials OK! Publishing..."

# upload_script uploads our Worker code with the appropriate metadata.
upload_script() {
  curl_api https://api.cloudflare.com/client/v4/accounts/$ACCOUNT_ID/workers/scripts/$SCRIPT_NAME \
      -X PUT \
      -F "metadata=@metadata.json;type=application/json" \
      -F "script=@index.mjs;type=application/javascript+module" \
      -F "datatable=@datatable.mjs;type=application/javascript+module" \
      -F "router=@router.mjs;type=application/javascript+module" \
      -F "html=@index.html;type=application/octet-stream" > /dev/null
}

# upload_bootstrap_script is a temporary hack to work around a chicken-and-egg problem: in order
# to define a Durable Object namespace, we must tell it a script and class name. But when we upload
# our script, we need to configure the environment to bind to our durable object namespaces. This
# function uploads a version of our script with an empty environment (no bindings). The script won't
# be able to run correctly, but this gets us far enough to define the namespaces, and then we can
# upload the script with full environment later.
#
# This is obviously dumb and we (Cloudflare) will come up with something better soon.
upload_bootstrap_script() {
  echo '{"main_module": "index.mjs"}' > bootstrap-metadata.json
  curl_api https://api.cloudflare.com/client/v4/accounts/$ACCOUNT_ID/workers/scripts/$SCRIPT_NAME \
      -X PUT \
      -F "metadata=@bootstrap-metadata.json;type=application/json"
      -F "script=@index.mjs;type=application/javascript+module" \
      -F "html=@index.html;type=application/octet-stream" > /dev/null
  rm bootstrap-metadata.json
}

# upsert_namespace configures a Durable Object namespace so that instances of it can be created
# and called from other scripts (or from the same script). This function checks if the namespace
# already exists, creates it if it doesn't, and either way writes the namespace ID to stdout.
#
# The namespace ID can be used to configure environment bindings in other scripts (or even the same
# script) such that they can send messages to instances of this namespace.
upsert_namespace() {
  # Check if the namespace exists already.
  EXISTING_ID=$(\
      curl_api https://api.cloudflare.com/client/v4/accounts/$ACCOUNT_ID/workers/durable_objects/namespaces | \
      jq -r ".[] | select(.script == \"$SCRIPT_NAME\" and .class == \"$1\") | .id")

  if [ "$EXISTING_ID" != "" ]; then
    echo $EXISTING_ID
    return
  fi

  # No. Create it.
  curl_api https://api.cloudflare.com/client/v4/accounts/$ACCOUNT_ID/workers/durable_objects/namespaces \
      -X POST --data "{\"name\": \"$SCRIPT_NAME-$1\", \"script\": \"$SCRIPT_NAME\", \"class\": \"$1\"}" | \
      jq -r .id
}

if [ ! -e metadata.json ]; then
  # If metadata.json doesn't exist we assume this is first-time setup and we need to create the
  # namespaces.

  upload_bootstrap_script
  TABLES_ID=$(upsert_namespace DataTable)

  cat > metadata.json << __EOF__
{
  "main_module": "index.mjs",
  "bindings": [
    {
      "type": "durable_object_namespace",
      "name": "tables",
      "namespace_id": "$TABLES_ID"
    }
  ]
}
__EOF__
fi

upload_script

echo "App uploaded to your account under the name: $SCRIPT_NAME"
echo "You may deploy it to a specific host in the Cloudflare Dashboard."
