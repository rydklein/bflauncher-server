## Schemas
### BFGame
```
enum BFGame {
    "BF4",
    "BF1",
}
```
Enum representing BF4 or BF1.
### GameState
```
enum GameState {
    "UNOWNED",
    "IDLE",
    "LAUNCHING",
    "JOINING",
    "ACTIVE",
}
```
Enum representing the current state of a seeder machine.
### ServerData
```
{
    "name":string | null,
    "guid":string | null,
    "gameId":string | null;
    "user":string,
    "timestamp":number
}
```
Name - Server Name. Null if seeder isn't targeted.

GUID - Server GUID. Only set for BF4 servers, null otherwise.

gameId - Server's Game ID. Changes ocassionally.

user - The Discord user who "created" this target. Defaults to System.

timestamp - The Unix timestamp that the target was "created" at.

### SeederData
```
{
    username:string
    hostname:string,
    id:string
    stateBF4:GameState,
    stateBF1:GameState,
    targetBF4:ServerData,
    targetBF1:ServerData,
    version:string
}
```
username - The username of the Origin account active on the seeder machine.

hostname - The computer name of the seeder machine.

id - The internal id of the machine. Assigned randomly upon connection.

stateBF4, stateBF1 - The current GameState of the machine for BF4 and BF1.

targetBF4, targetBF1 - The current ServerData of the machine.

version - The current SeederControl-Client version of the machine.
### AutomationStatus
```
{
    "enabled":boolean,
    "user":string,
    "timestamp":number
}
```
enabled - Whether automation is currently enabled on the panel.

user - The user that last changed the AutomationStatus.

timestamp - The unix timestamp that AutomationStatus was last changed at.
## Authorization
All endpoints require an IP whitelist as well as an authorization token. Send the token in the Authorization header.
## Endpoints
### GET /api/getAuto
Returns the current `AutomationStatus`. Note that `AutomationStatus` does not affect the usability of the API. It falls upon the user of the API to check the `AutomationStatus` before performing any tasks that would be undesirable with automation disabled.

Required Headers:

`"Authorization": "YOUR TOKEN HERE"`
### GET /api/getSeeders
Returns an array of `SeederData` representing all connected Seeder clients.

Required Headers:

`"Authorization": "YOUR TOKEN HERE"`
### POST /api/sendSeeders
Sends specified seeders to the specified server.

Required Headers:

`"Authorization": "YOUR TOKEN HERE"`

`"Content-Type": "application/json"`

Request body:
```
{
    game:BFGame,
    target:string | null,
    seeders:Array<string>
}
```
game - The Battlefield title to send the seeders to.

target - The server to send the seeders to. Either a gameId (Battlefield 1 servers) a GUID (Battlefield 4 servers), or `null` to disconnect the seeder from an existing target.

seeders - An array of seeder ids.