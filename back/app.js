require('dotenv').config()
const express = require('express')
const http = require('http')
const cors = require('cors')
const {Server} = require('socket.io')
const fs = require('fs')

const app = express()
app.use(cors())

const server = http.createServer(app)
server.listen(process.env.WS_PORT, () => console.log('Listening', process.env.WS_PORT))
const io = new Server(server, {cors: '*'})

app.get('/', (_req, res) => {res?.send('AAUgghh')})

/////////////////////////////////////////////////

const coloredTypes = [
  '0', '1', '2', '3', '4', '5', '6', '7', '8', '9',
  'malus', 'reverse', 'pass'
]
const specials = ['joker', 'superJoker']
const cardsColors = ['red', 'blue', 'green', 'yellow']
const defaultAmount = 15
const maxPlayersByRoom = 5

const getDefaultPile = () => {
  let newDeck = []

  coloredTypes?.forEach((type) => {
    cardsColors?.forEach((color) => {
      for (let i = 0; i !== 2; i++) {newDeck.push(color + '-' + type)}
    })
  })
  specials?.forEach((special) => {
    for (let i = 0; i !== cardsColors?.length; i++) {newDeck.push(special)}
  })

  return shuffle(newDeck)
}

const shuffle = (arr) => {
  let currentIndex = arr.length,  randomIndex

  while (currentIndex != 0) {
    randomIndex = Math.floor(Math.random() * currentIndex)
    currentIndex--
    [arr[currentIndex], arr[randomIndex]] = [arr[randomIndex], arr[currentIndex]]
  }

  return arr
}

let rooms = {}

const defaultState = {
  isStarted: false,
  malus: 0,
  isDefaultSens: true,
  nextColor: undefined
}

io.on('connect', (socket) => {
  socket.on('joinRoom', (data) => {
    let isPseudoUnique = true

    if (!rooms[data?.room]?.state.isStarted) {
      if (rooms[data?.room] === undefined) {
        rooms = {...rooms, [data?.room]: {
          users: [],
          state: {...defaultState}
        }}
      }

      if (rooms[data?.room]?.users?.length < maxPlayersByRoom) {
        rooms[data?.room]?.users?.forEach((elem) => {
          if (elem?.pseudo.toLowerCase() === data?.pseudo.toLowerCase()) {
            isPseudoUnique = false
          }
        })
        if (isPseudoUnique) {
          rooms[data?.room]?.users?.push({
            id: socket?.id,
            pseudo: data?.pseudo
          })
          socket.join(data?.room)
          io.in(data?.room).emit('joined', rooms[data?.room]?.users)
        } else {
          socket.emit('unavailablePseudo')
        }
      } else {
        socket.emit('maxPlayers')
      }
    } else {
      socket.emit('alreadyStarted')
    }
  })

  socket.on('leaveRoom', (data) => {
    socket.leave(data?.room)
    rooms[data?.room] = {users: rooms[data?.room]?.users?.filter((elem) => {
      return elem?.pseudo !== data?.pseudo
    })}
    io.in(data?.room).emit('joined', rooms[data?.room]?.users)
  })

  socket.on('startGame', (data) => {
    let pile = getDefaultPile()
    let hands = generateHands(rooms[data?.room], pile)
    let current = pick(1, pile)

    rooms[data?.room].state = {
      ...rooms[data?.room].state,
      isStarted: true,
      pile: pile,
      hands: hands,
      current: current,
      turn: getRandomTurn(rooms[data?.room])
    }
    io.in(data?.room).emit('launchGame', rooms[data?.room]?.state)
  })

  socket.on('playCard', (data) => {
    const {pseudo, room, cardIndex} = data
    const newState = rooms[room]?.state
    const played = newState.hands[pseudo][cardIndex]

    newState.pile.splice(
      Math.floor(Math.random() * newState.pile?.length),
      0,
      newState.hands[pseudo][cardIndex]
    )
    newState.current = played
    newState.hands[pseudo].splice(cardIndex, 1)
    if (played.substring(played.indexOf('-') + 1) === 'malus') {
      newState.malus += 2
    } else if (played.substring(played.indexOf('-') + 1) === 'superJoker') {
      newState.malus += 4
    } else if (played.substring(played.indexOf('-') + 1) === 'reverse') {
      newState.isDefaultSens = !newState.isDefaultSens
    }

    if (newState.hands[pseudo]?.length === 0) {
      io.in(room).emit('winner', {pseudo})
    } else {
      rooms[room].state = newState
      io.in(room).emit('updateState', newState)
    }
  })

  socket.on('pickCard', (data) => {
    const {pseudo, room} = data
    const newState = rooms[room]?.state
    const random = Math.floor(Math.random() * newState.pile?.length)

    newState.hands[pseudo].push(newState.pile[random])
    newState.pile.splice(random, 1)

    rooms[room].state = newState
    io.in(room).emit('updateState', newState)
  })

  socket.on('endTurn', (data) => {
    const {room} = data
    const newState = rooms[room]?.state

    newState.turn = getNextTurn(rooms[room], newState?.turn)
    if (newState?.malus !== 0) {
      newState.hands[newState.turn?.pseudo]
      newState.hands[newState.turn?.pseudo] =
        newState.hands[newState.turn?.pseudo].concat(pick(newState?.malus, newState?.pile))
      newState.turn = getNextTurn(rooms[room], newState?.turn)
    }
    newState.malus = 0
    io.in(room).emit('updateState', newState)
  })

  socket.on('setColor', (data) => {
    const {room, color} = data
    const newState = rooms[room]?.state

    newState.current = color + '-color'
    newState.turn = getNextTurn(rooms[room], newState.turn)

    io.in(room).emit('updateState', newState)
  })
})

const getNextTurn = (room, oldTurn) => {
  let newIndex


  room?.users?.forEach((elem, i) => {
    if (room?.state?.isDefaultSens) {
      if (elem?.pseudo === oldTurn?.pseudo) {
        newIndex = i === room?.users?.length - 1 ? 0 : i + 1
      }
    } else {
      if (elem?.pseudo === oldTurn?.pseudo) {
        newIndex = i === 0 ? room?.users?.length - 1 : i - 1
      }
    }
  })
  return room?.users[newIndex]
}

const getRandomTurn = (room) => {
  return room?.users[Math.floor(Math.random() * room?.users?.length)]
}

const generateHands = (room, pile) => {
  let newHands = {}

  room?.users?.forEach((elem) => {
    newHands[elem?.pseudo] = pick(defaultAmount, pile)
  })

  return newHands
}

const pick = (amount, pile) => {
  let picked = amount === 1 ? undefined : []
  let randomIndex

  for (let i = 0; i !== amount; i++) {
    randomIndex = Math.floor(Math.random() * pile?.length)

    if (amount === 1) {picked = pile[randomIndex]}
    else {picked.push(pile[randomIndex])}
    pile.splice(randomIndex, 1)
  }

  return picked
}