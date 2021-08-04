type SeederData = import("../commonTypes").SeederData;
type Socket = import("socket.io-client").Socket;
declare function io(path);
declare const sorttable;
const socket:Socket = io("/ws/web");
let statusTimeout:ReturnType<typeof setTimeout> | null;
const guidRegex = new RegExp("^[{]?[0-9a-fA-F]{8}-([0-9a-fA-F]{4}-){3}[0-9a-fA-F]{12}[}]?$");
let mouseDown = false;
let lastServerId = "";
// #region Seeder Display
// #region Table Utils
enum TableFields {
    "CHECK",
    "MNAME",
    "ANAME",
    "SBF4",
    "SBF1",
}
const stateColor = {
    "UNOWNED": "#7f8c8d",
    "IDLE": "#e74c3c",
    "LAUNCHING": "#f39c12",
    "JOINING": "#f1c40f",
    "ACTIVE": "#2ecc71",
};
function setSeeder(seederId:string, seederData:SeederData) {
    let row = document.getElementById(seederId) as HTMLTableRowElement;
    if (!row) {
        const table = document.getElementById("seeders")!.getElementsByTagName("tbody")[0];
        row = table.insertRow();
        row.id = seederId;
        row.hidden = true;
        for (let i = Object.keys(TableFields).length / 2; i > 0; i--) {
            row.insertCell();
        }
        const checkBox = document.createElement("input");
        checkBox.setAttribute("type", "checkbox");
        checkBox.setAttribute("onmouseover", "checkboxDragHandler(this)");
        checkBox.setAttribute("class", "machineCheck");
        row.cells[TableFields["CHECK"]].appendChild(checkBox);
        updateSeederCount();
    }
    row.cells[TableFields["MNAME"]].innerText = seederData.hostname;
    row.cells[TableFields["ANAME"]].innerText = seederData.username;
    row.cells[TableFields["SBF4"]].innerText = seederData.targetBF4.guid || (seederData.stateBF4 === "UNOWNED" ? "UNOWNED" : "NONE");
    row.cells[TableFields["SBF4"]].title = `${seederData.targetBF4.name || "NONE"}\n${new Date(seederData.targetBF4.timestamp).toLocaleString()}\n${seederData.targetBF4.user}`;
    row.cells[TableFields["SBF4"]].style.backgroundColor = stateColor[seederData.stateBF4];
    row.cells[TableFields["SBF4"]].className = "coloredBack";
    row.cells[TableFields["SBF1"]].innerText = seederData.targetBF1.guid || (seederData.stateBF1 === "UNOWNED" ? "UNOWNED" : "NONE");
    row.cells[TableFields["SBF1"]].title = `${seederData.targetBF1.name || "NONE"}\n${new Date(seederData.targetBF1.timestamp).toLocaleString()}\n${seederData.targetBF1.user}`;
    row.cells[TableFields["SBF1"]].style.backgroundColor = stateColor[seederData.stateBF1];
    row.cells[TableFields["SBF1"]].className = "coloredBack";
    const sortElement = document.getElementsByClassName("sorttable_sorted_reverse")[0] || document.getElementsByClassName("sorttable_sorted")[0];
    if (sortElement) {
        sorttable.innerSortFunction.apply(sortElement, null);
    }
    row.hidden = false;
}
function removeSeeder(seederId:string) {
    document.getElementById(seederId)!.remove();
}
function updateSeederCount() {
    document.getElementById("seederCount")!.innerText = document.getElementById("seeders")!.getElementsByTagName("tbody")[0].children.length.toString();
}
function getCheckedSeeders() {
    const checkedSeeders:Array<string> = [];
    const checkedBoxes = [...(document.getElementsByClassName("machineCheck") as HTMLCollectionOf<HTMLInputElement>)].filter(element => element.checked);
    for (const box of checkedBoxes) {
        checkedSeeders.push(box.parentElement!.parentElement!.id);
    }
    return checkedSeeders;
}
// #endregion
let seeders:Map<string, SeederData>;
socket.emit("getSeeders", (seedersRaw) => {
    seeders = JSON.parse(seedersRaw, mapReviver);
    for (const [mapKey, mapValue] of seeders) {
        setSeeder(mapKey, mapValue);
    }
});
socket.on("seederUpdate", (seederId:string, seederValue:SeederData) => {
    setSeeder(seederId, seederValue);
});
socket.on("seederGone", (seederId:string) => {
    removeSeeder(seederId);
    updateSeederCount();
});
// #endregion
// #region Input
// Executed on load and when game dropdown is changed. Changes game-specific instructions.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function sendMachinesToServer() {
    const targetInput = document.getElementById("newTargetInput") as HTMLInputElement;
    const statusText = document.getElementById("newTargetStatus") as HTMLInputElement;
    const game = (<HTMLInputElement>document.getElementById("game")).value;
    if (game === "BF4") {
        if (!guidRegex.test(targetInput.value)) {
            statusText.innerText = "Input is not a valid GUID.";
            showStatusText();
            return;
        }
    }
    if (game === "BF1") {
        if (!((targetInput.value.length === 13) && !(isNaN(parseInt(targetInput.value))))) {
            statusText.innerText = "Input is not a valid Game ID";
            showStatusText();
            return;
        }
    }
    if (!getCheckedSeeders()[0]) {
        statusText.innerText = "Please select one or more bot(s).";
        showStatusText();
        return;
    }
    const setSuccess = await (() => {
        return new Promise((resolve) => {
            socket.emit("setTarget", game, getCheckedSeeders(), targetInput.value, (success) => {
                resolve(success);
            });
        });
    })();
    if (!setSuccess) {
        statusText.innerText = "Input did not resolve to a server.";
    } else {
        statusText.innerText = "Success!";
    }
    showStatusText();
}
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function disconnectFromServer() {
    const statusText = document.getElementById("newTargetStatus")!;
    const game = (<HTMLInputElement>document.getElementById("game")).value;
    if (!getCheckedSeeders()[0]) {
        statusText.innerText = "Please select one or more bot(s).";
    } else {
        statusText.innerText = "Successfully instructed clients to disconnect.";
        socket.emit("setTarget", game, getCheckedSeeders(), null, (success) => {
            if (!success) console.log("Error disconnecting.");
        });
    }
    showStatusText();
}
function gameListener() {
    const bf4ServerIdentifier = "Server GUID";
    const bf1ServerIdentifier = "Game ID";
    const targetIDInput = document.getElementById("newTargetInput") as HTMLInputElement;
    const lastServerIdTemp = targetIDInput.value;
    const serverIDDesc = document.getElementById("newTargetStatus");
    const value = (<HTMLInputElement>document.getElementById("game")).value;
    if (value === "BF4") {
        targetIDInput.placeholder = bf4ServerIdentifier;
        serverIDDesc!.innerText = bf4ServerIdentifier;
    }
    if (value === "BF1") {
        targetIDInput.placeholder = bf1ServerIdentifier;
        serverIDDesc!.innerText = bf1ServerIdentifier;
    }
    targetIDInput.value = lastServerId;
    lastServerId = lastServerIdTemp;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function checkAllMachines(bigCheck:HTMLInputElement) {
    const checkboxes = document.getElementsByClassName("machineCheck") as HTMLCollectionOf<HTMLInputElement>;
    if (bigCheck.checked) {
        for (let i = 0; i < checkboxes.length; i++) {
            if (checkboxes[i].type == "checkbox") {
                checkboxes[i].checked = true;
            }
        }
    } else {
        for (let i = 0; i < checkboxes.length; i++) {
            if (checkboxes[i].type == "checkbox") {
                checkboxes[i].checked = false;
            }
        }
    }
}
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function checkboxDragHandler(element:HTMLInputElement) {
    if (mouseDown) element.checked = !element.checked;
}
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function restartOrigin() {
    const statusText = document.getElementById("newTargetStatus") as HTMLInputElement;
    if (!getCheckedSeeders()[0]) {
        statusText.innerText = "Please select one or more bot(s).";
        showStatusText();
        return;
    } else {
        const checkedSeeders = getCheckedSeeders();
        const confirmMessage = `Are you sure you want to restart Origin on ${checkedSeeders.length} client${checkedSeeders.length > 1 ? "s" : ""}?`;
        if (!window.confirm(confirmMessage)) return;
        statusText.innerText = "Restarting Origin.";
        socket.emit("restartOrigin", );
    }
    showStatusText();
}
// #endregion
// #region Event Listeners
document.addEventListener("DOMContentLoaded", () => {
    document.body.onmousedown = function() { 
        mouseDown = true;
    };
    document.body.onmouseup = function() {
        mouseDown = false;
    };
    gameListener();
    sorttable.innerSortFunction.apply(document.getElementById("mColumn"), null);
}, false); 
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
function showStatusText() {
    const statusText = document.getElementById("newTargetStatus") as HTMLInputElement;
    statusText.hidden = false;
    if(statusTimeout) {
        clearTimeout(statusTimeout);
        statusTimeout = null;
    }
    statusTimeout = setTimeout(() => {
        statusText.hidden = true;
    }, 5000);
}
// #endregion