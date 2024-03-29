export interface AutomationStatus {
    "enabled":boolean,
    "user":string,
    "timestamp":number
}
export interface SeederData {
    username:string
    hostname:string,
    stateBF4:GameState,
    stateBF1:GameState,
    targetBF4:ServerData,
    targetBF1:ServerData,
    version:string
}
export interface ServerData {
    "name":string | null,
    "game":BFGame,
    "guid":string | null,
    "gameId":string | null;
    "user":string,
    "timestamp":number
}
export enum BFGame {
    "BF4",
    "BF1",
}
enum GameState {
    "UNOWNED",
    "IDLE",
    "LAUNCHING",
    "JOINING",
    "ACTIVE",
}