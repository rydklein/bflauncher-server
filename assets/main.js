/* eslint-disable @typescript-eslint/no-unused-vars */
/* global io*/
const socket = io("/ws/web");
const guidRegex = new RegExp("^[{]?[0-9a-fA-F]{8}-([0-9a-fA-F]{4}-){3}[0-9a-fA-F]{12}[}]?$");
let statusTimeout;
let currentTarget;
document.addEventListener("DOMContentLoaded", function() {
    gameListener();
}, false);
// #region Seeders
let seeders;
socket.emit("getSeeders", (seedersRaw) => {
    seeders = JSON.parse(seedersRaw, mapReviver);
    const table = document.getElementById("seeders");
    for (const [mapKey, mapValue] of seeders) {
        addSeederRow(table, mapKey, {
            "BF4":mapValue.BF4 || null,
            "BF1":mapValue.BF1 || null,
            "timestamp":Date.now(),
        });
    }
});
socket.on("seederUpdate", (hostname, game, newSeeder) => {
    const seederRow = document.getElementById(hostname);
    if (!seederRow) {
        if (newSeeder) {
            addSeederRow(document.getElementById("seeders"), hostname, {
                "BF4":game === "BF4" ? newSeeder : null,
                "BF1":game === "BF1" ? newSeeder : null,
                "timestamp":Date.now(),
            });
        }
        return;
    }
    if (!game) return seederRow.remove();
    if (game === "BF4") {
        seederRow.cells[1].innerText = newSeeder;
    }
    if (game === "BF1") {
        seederRow.cells[2].innerText = newSeeder;
    }
    seederRow.cells[3].innerText = new Date().toLocaleTimeString("en-us");
});
function addSeederRow(table, seederName, seederData) {
    const row = table.insertRow();
    row.id = `${seederName}`;
    // Name
    const seederNameC = row.insertCell();
    const nameCellText = document.createTextNode(seederName);
    seederNameC.appendChild(nameCellText);
    // Status BF4
    const seederStatusBF4C = row.insertCell();
    let seederStatusBF4T;
    if (seederData["BF4"]) {
        seederStatusBF4T = document.createTextNode(seederData["BF4"]["state"]);
    } else {
        seederStatusBF4T = document.createTextNode("UNOWNED");
    }
    seederStatusBF4C.appendChild(seederStatusBF4T);
    // Status BF1
    const seederStatusBF1C = row.insertCell();
    let seederStatusBF1T;
    if (seederData["BF1"]) {
        seederStatusBF1T = document.createTextNode(seederData["BF1"]["state"]);
    } else {
        seederStatusBF1T = document.createTextNode("UNOWNED");
    }
    seederStatusBF1C.appendChild(seederStatusBF1T);
    // Timestamp
    const seederTimeC = row.insertCell();
    const seederTimeT = document.createTextNode(new Date(seederData["timestamp"]).toLocaleTimeString("en-us"));
    seederTimeC.appendChild(seederTimeT);
}
// #endregion
// #region Targets
socket.emit("getTarget", (newTarget) => {
    currentTarget = newTarget;
    updateTarget("BF4", newTarget["BF4"]);
    updateTarget("BF1", newTarget["BF1"]);
});

socket.on("newTarget", (game, newTarget) => {
    updateTarget(game, newTarget);
});
function updateTarget(game, newTarget) {
    const parentDiv = document.getElementById(`${game}Status`);
    const targetNameSpan = parentDiv.querySelector("#targetName");
    const targetLink = parentDiv.querySelector("#targetLink");
    const targetLinkSpan = parentDiv.querySelector("#targetLinkSpan");
    const targetAuthor = parentDiv.querySelector("#targetAuthor");
    const setBy = `Set by ${newTarget.user} at ${new Date(newTarget.timestamp).toLocaleTimeString()}.`;
    if(!newTarget.guid) {
        targetNameSpan.innerText = "Not currently in-game.";
        targetLinkSpan.hidden = true;
    } else {
        targetNameSpan.innerText = `${newTarget.name}`;
        if (game === "BF4") {
            targetLink.href = `https://battlelog.battlefield.com/bf4/servers/show/PC/${newTarget.guid}`;
        }
        if (game === "BF1") {
            targetLink.href = `https://gametools.network/servers/bf1/gameid/${newTarget.guid}/pc`;
        }
        targetLink.textContent = newTarget.guid;
        targetLinkSpan.hidden = false;
    }
    targetAuthor.innerText = setBy;
    targetAuthor.hidden = false;
    currentTarget[game] = newTarget;
}
// #endregion
// #region User Input
async function submitGUIDChange() {
    const guidInput = document.getElementById("serverGUID");
    const disconnectButton = document.getElementById("disconnect");
    const guidSubmit = document.getElementById("guidSubmit");
    const statusText = document.getElementById("guidChangeStatus");
    const game = document.getElementById("game").value;
    if (game === "BF4") {
        if (!guidRegex.test(guidInput.value)) {
            statusText.innerText = "Input is not a valid GUID.";
            showStatusText(statusText);
            return;
        }
    }
    if (game === "BF1") {
        if (!((guidInput.value.length === 13) && !(isNaN(parseInt(guidInput.value))))) {
            statusText.innerText = "Input is not a valid Game ID";
            showStatusText(statusText);
            return;
        }
    }
    disconnectButton.disabled = true;
    guidSubmit.disabled = true;
    const setSuccess = await (() => {
        return new Promise((resolve) => {
            socket.emit("setTarget", game, guidInput.value, (success) => {
                resolve(success);
            });
        });
    })();
    if (!setSuccess) {
        statusText.innerText = "Input did not resolve to a server.";
    } else {
        statusText.innerText = "Success!";
    }
    showStatusText(statusText);
}
function showStatusText() {
    const disconnectButton = document.getElementById("disconnect");
    const guidSubmit = document.getElementById("guidSubmit");
    const statusText = document.getElementById("guidChangeStatus");
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
    const game = document.getElementById("game").value;
    if (!currentTarget[game].guid) {
        statusText.innerText = "Already disconnected.";
    } else {
        statusText.innerText = "Successfully instructed clients to disconnect.";
        socket.emit("setTarget", game, null, (success) => {
            if (!success) console.log("Error disconnecting.");
        });
    }
    showStatusText();
}
function gameListener() {
    const guidInput = document.getElementById("serverGUID");
    const bf4ServerIdentifier = "Server GUID";
    const bf1ServerIdentifier = "Game ID";
    const idiotInstructions = document.getElementById("idiotInstructions");
    const value = document.getElementById("game").value;
    if (value === "BF4") {
        guidInput.placeholder = bf4ServerIdentifier;
        idiotInstructions.innerText = bf4ServerIdentifier;
    }
    if (value === "BF1") {
        guidInput.placeholder = bf1ServerIdentifier;
        idiotInstructions.innerText = bf1ServerIdentifier;
    }
}
// #endregion
// #region Helpers
function mapReviver(key, value) {
    if (typeof value === "object" && value !== null) {
        if (value.dataType === "Map") {
            return new Map(value.value);
        }
    }
    return value;
}
// #endregion