nodes=( "inp" "dex" "out")

for i in "${nodes[@]}"
do
    shareName=$(az webapp config storage-account list -g rg-dfx-api-$1 -n app-dfx-node-$i-$1 --query "[0].value.shareName")
    if [[ $shareName == *a\" ]]
    then
        echo "$i: A"
    else
        echo "$i: B"
    fi
done
