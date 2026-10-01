PODNAME=$(kubectl get pods -n dev -l app=firestartr-controller -o jsonpath="{.items[0].metadata.name}")
if [ -z "$PODNAME" ]; then
    echo "No pod found with label app=firestartr-controller in dev namespace."
    exit 1
fi
kubectl exec -n dev -it $PODNAME -- bash
