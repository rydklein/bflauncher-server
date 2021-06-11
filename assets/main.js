/* global io*/
const socket = io("/ws/web");
const guidRegex = new RegExp("^[{]?[0-9a-fA-F]{8}-([0-9a-fA-F]{4}-){3}[0-9a-fA-F]{12}[}]?$");
let statusTimeout;
let currentTarget;
// #region Seeders
let seeders;
socket.emit("getSeeders", (seedersRaw) => {
    seeders = JSON.parse(seedersRaw, mapReviver);
    const table = document.getElementById("seeders");
    for (const [mapKey, mapValue] of seeders) {
        addSeederRow(table, mapKey, mapValue);
    }
});
socket.on("seederUpdate", (hostname, newSeeder) => {
    const seederRow = document.getElementById(hostname);
    if (!seederRow) {
        if (newSeeder) {
            addSeederRow(document.getElementById("seeders"), hostname, {
                "state":newSeeder,
                "timestamp":Date.now(),
            });
        }
        return;
    }
    if (!newSeeder) return seederRow.remove();
    seederRow.cells[1].innerText = newSeeder;
    seederRow.cells[2].innerText = new Date().toLocaleTimeString("en-us");
});
// #endregion
// #region Targets
socket.emit("getTarget", (newTarget) => {
    currentTarget = newTarget;
    updateTarget(newTarget);
});
socket.on("newTarget", (newTarget) => {
    currentTarget = newTarget;
    updateTarget(newTarget);
});
// #endregion
function mapReviver(key, value) {
    if (typeof value === "object" && value !== null) {
        if (value.dataType === "Map") {
            return new Map(value.value);
        }
    }
    return value;
}
function addSeederRow(table, seederName, seederData) {
    const row = table.insertRow();
    row.id = `${seederName}`;
    // Name
    const seederNameC = row.insertCell();
    const nameCellText = document.createTextNode(seederName);
    seederNameC.appendChild(nameCellText);
    // Status
    const seederStatusC = row.insertCell();
    const seederStatusT = document.createTextNode(seederData["state"]);
    seederStatusC.appendChild(seederStatusT);
    // Timestamp
    const seederTimeC = row.insertCell();
    const seederTimeT = document.createTextNode(new Date(seederData["timestamp"]).toLocaleTimeString("en-us"));
    seederTimeC.appendChild(seederTimeT);
}
// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function submitGUIDChange() {
    const guidInput = document.getElementById("serverGUID");
    const disconnectButton = document.getElementById("disconnect");
    const guidSubmit = document.getElementById("guidSubmit");
    const statusText = document.getElementById("guidChangeStatus");
    let setSuccess;
    if (!guidRegex.test(guidInput.value)) {
        statusText.innerText = "Input is not a valid GUID.";
        statusText.hidden = false;
        return;
    } else {
        disconnectButton.disabled = true;
        guidSubmit.disabled = true;
        setSuccess = await (() => {
            return new Promise((resolve) => {
                socket.emit("setTarget", guidInput.value, (success) => {
                    resolve(success);
                });
            });
        })();
    }
    if (!setSuccess) {
        statusText.innerText = "Input did not resolve to a server.";
    } else {
        statusText.innerText = "Success!";
    }
    statusText.hidden = false;
    if(statusTimeout) {
        clearTimeout(statusTimeout);
        statusTimeout = null;
    }
    statusTimeout = setTimeout(() => {
        statusText.hidden = true;
        disconnectButton.disabled = false;
        guidSubmit.disabled = false;
    }, 5000);
}
function disconnectFromServer() {
    const disconnectButton = document.getElementById("disconnect");
    const guidSubmit = document.getElementById("guidSubmit");
    const statusText = document.getElementById("guidChangeStatus");
    if (!currentTarget.guid) {
        statusText.innerText = "Already disconnected.";
    } else {
        statusText.innerText = "Successfully instructed clients to disconnect.";
    }
    socket.emit("setTarget", null, (success) => {
        if (!success) console.log("Error disconnecting.");
    });
    disconnectButton.disabled = true;
    guidSubmit.disabled = true;
    statusText.hidden = false;
    if(statusTimeout) {
        clearTimeout(statusTimeout);
        statusTimeout = null;
    }
    statusTimeout = setTimeout(() => {
        statusText.hidden = true;
        disconnectButton.disabled = false;
        guidSubmit.disabled = false;
    }, 5000);
}
function updateTarget(currentTarget) {
    const targetNameSpan = document.getElementById("targetName");
    const targetLinkSpan = document.getElementById("targetLink");
    const currentlyTargeting = document.getElementById("currentlyTargeting");
    const targetAuthor = document.getElementById("targetAuthor");
    const setBy = `Set by ${currentTarget.user} at ${new Date(currentTarget.timestamp).toLocaleTimeString()}.`;
    if(!currentTarget.guid) {
        targetNameSpan.innerText = "Not currently in-game.";
        currentlyTargeting.hidden = true;
        targetLinkSpan.hidden = true;
    } else {
        targetNameSpan.innerText = `${currentTarget.name}`;
        targetLinkSpan.href = `https://battlelog.battlefield.com/bf4/servers/show/PC/${currentTarget.guid}`;
        targetLinkSpan.textContent = currentTarget.guid;
        currentlyTargeting.hidden = false;
        targetLinkSpan.hidden = false;
    }
    targetAuthor.innerText = setBy;
    targetAuthor.hidden = false;
}