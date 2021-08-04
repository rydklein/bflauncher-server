export interface SeederData {
    username:string
    hostname:string,
    stateBF4:string,
    stateBF1:string,
    targetBF4:ServerData,
    targetBF1:ServerData,
    lastUpdate:number
}
export interface ServerData {
    "name":string | null,
    "guid":string | null,
    "user":string,
    "timestamp":number
}