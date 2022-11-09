const crypto = require("crypto"), SHA256 = message => crypto.createHash("sha256").update(message).digest("hex");
const EC = require("elliptic").ec, ec = new EC("secp256k1");
const { Block, Blockchain, ErenChain, Transaction } = require("./ErenChain");

const MINT_PRIVATE_ADDRESS = "0700a1ad28a20e5b2a517c00242d3e25a88d84bf54dce9e1733e6096e6d6495e";
const MINT_KEY_PAIR = ec.keyFromPrivate(MINT_PRIVATE_ADDRESS, "hex");
const MINT_PUBLIC_ADDRESS = MINT_KEY_PAIR.getPublic("hex");

const privateKey = "39a4a81e8e631a0c51716134328ed944501589b447f1543d9279bacc7f3e3de7";
const keyPair = ec.keyFromPrivate(privateKey, "hex");
const publicKey = keyPair.getPublic("hex");

const WS = require("ws");
const { group } = require("console");

const PORT = 3001;
const PEERS = ["ws://localhost:3000"];
const MY_ADDRESS = "ws://localhost:3001";
const server = new WS.Server({ port: PORT });

let opened = [], connected = [];
let check = [];
let checked = [];
let checking = false;
let tempChain = new Blockchain();

console.log("Listening on PORT", PORT);

server.on("connection", async (socket, req) => {
    socket.on("message", message => {
        const _message = JSON.parse(message);

        switch (_message.type) {
            case "TYPE_HANDSHAKE":
                const nodes = _message.data;

                nodes.forEach(node => connect(node));
            
            case "TYPE_CREATE_TRANSACTION":
                const transaction = _message.data;

                ErenChain.addTransaction(transaction);

                break;

            case "TYPE_REPLACE_CHAIN":
                const [ newBlock, newDiff ] = _message.data;

                const ourTx = [...ErenChain.transactions.map(tx => JSON.stringify(tx))];
                const theirTx = [...newBlock.data.filter(tx => tx.from !== MINT_PUBLIC_ADDRESS)];
                const n = theirTx.length;

                if (newBlock.prevHash !== ErenChain.getLastBlock().prevHash) {
                    for (let i = 0; i < n; i++) {
                        const index = ourTx.indexOf(theirTx[0]);

                        if (index === -1) break;

                        ourTx.splice(index, 1);
                        theirTx.splice(0, 1);
                    }

                    if (
                        theirTx.length === 0 &&
                        SHA256(ErenChain.getLastBlock().hash + newBlock.timestamp + JSON.stringify(newBlock.data) + newBlock.nonce) === newBlock.hash &&
                        newBlock.hash.startsWith("000" + Array(Math.round(Math.log(ErenChain.difficulty) / Math.log(16) + 1)).join("0")) &&
                        Block.hasValidTransactions(newBlock, ErenChain) &&
                        (parseInt(newBlock.timestamp) > parseInt(ErenChain.getLastBlock().timestamp) || ErenChain.getLastBlock().timestamp === "") &&
                        parseInt(newBlock.timestamp) < Date.now() &&
                        ErenChain.getLastBlock().hash === newBlock.prevHash &&
                        (newDiff + 1 === ErenChain.difficulty || newDiff - 1 === ErenChain.difficulty)
                    ) {
                        ErenChain.chain.push(newBlock);
                        ErenChain.difficulty = newDiff;
                        ErenChain.transactions = [...ourTx.map(tx => JSON.parse(tx))];
                    }
                } else if (!checked.includes(JSON.stringify([ErenChain.getLastBlock().prevHash, ErenChain.chain[ErenChain.chain.length - 2].timestamp]))) {
                    checked.push(JSON.stringify([ErenChain.getLastBlock().prevHash, ErenChain.chain[ErenChain.chain.length - 2].timestamp]));

                    const position = ErenChain.chain.length - 1;

                    checking = true;

                    sendMessage(produceMessage("TYPE_REQUEST_CHECK", MY_ADDRESS));

                    setTimeout(() => {
                        checking = false;

                        let mostAppeared = check[0];

                        check.forEach(group => {
                            if (check.filter(_group => _group === group).length > check.filter(_group => _group === mostAppeared).length) {
                                mostAppeared = group;
                            }
                        })

                        const group = JSON.parse(mostAppeared);

                        ErenChain.chain[position] = group[0];
                        ErenChain.transactions = [...group[1]];
                        ErenChain.difficulty = group[2];

                        check.splice(0, check.length);

                    }, 5000);
                }

                break;

            case "TYPE_REQUEST_CHECK":
                opened.filter(node => node.address === _message.data)[0].socket.send(JSON.stringify(produceMessage(
                    "TYPE_SEND_CHECK",
                    JSON.stringify([ ErenChain.getLastBlock(), ErenChain.transactions, ErenChain.difficulty])
                )));

                break;

            case "TYPE_SEND_CHECK":
                if (checking) check.push(_message.data);

                break;

            case "TYPE_REQUEST_CHAİN":
                const socket = opened.filter(node => node.address === _message.data)[0].socket;

                for (let i = 0; i < ErenChain.chain.length; i++) {
                    socket.send(JSON.stringify(produceMessage(
                        "TYPE_SEND_CHAİN",
                        {
                            block: ErenChain.chain[i],
                            finished: i === ErenChain.chain.length
                        }
                    )))
                }

                break;

            case "TYPE_SEND_CHAİN":
                const { block, finished } = _message.data;

                if(!finished) {
                    tempChain.chain.push(block);
                } else {
                    if (Blockchain.isValid(tempChain)) {
                        ErenChain.chain = tempChain.chain;
                    }
                    tempChain = new Blockchain();
                }

                break;

            case "TYPE_REQUEST_INFO":
                opened.filter(node => node.address === _message.data)[0].socket.send(
                    "TYPE_SEND_INFO",
                    [ ErenChain.difficulty, ErenChain.transactions ]
                );

                break;

            case "TYPE_SEND_INFO":
                [ErenChain.difficulty, ErenChain.transactions] = _message.data;
        }
    })
})

async function connect(address) {
    if (!connected.find(peerAddress => peerAddress === address) && address !== MY_ADDRESS) {
        const socket = new WS(address);

        socket.on("open", () => {
            socket.send(JSON.stringify(produceMessage("TYPE_HANDSHAKE", [MY_ADDRESS, ...connected])));

            opened.forEach(node => node.socket.send(JSON.stringify(produceMessage("TYPE_HANDSHAKE", [address]))));

            if (!opened.find(peer => peer.address === address) && address !== MY_ADDRESS) {
                opened.push({ socket, address });
            }

            if (!connected.find(peerAddress => peerAddress === address) && address !== MY_ADDRESS) {
                connected.push(address);
            }
        });

        socket.on("close", () => {
            opened.slice(connected.indexOf(address), 1);
            connected.slice(connected.indexOf(address), 1);
        })
    }
}

function produceMessage(type, data) {
    return { type, data };
}

function sendMessage(message) {
    opened.forEach(node => {
        node.socket.send(JSON.stringify(message));
    })
}

process.on("uncaughtException", err => console.log(err));

PEERS.forEach(peer => connect(peer));

setTimeout(() => {
    if (ErenChain.transactions.length !==0) {
        ErenChain.mineTransaction(publicKey);

        sendMessage(produceMessage("TYPE_REPLACE_CHAIN", [
        ErenChain.getLastBlock(),
        ErenChain.difficulty
        ]))
    }
}, 6500);

setTimeout(() => {
    console.log(opened);
    console.log(ErenChain);
}, 10000);