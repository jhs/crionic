angular.module('starter.services', ['ionic'])

.factory('DB', function($q) {
  var crimes_origin = new PouchDB('https://opendata.cloudant.com/crimes')
  var crimes = new PouchDB('crimes')
  var config = new PouchDB('config')
  var noop = function() {}

  // Use this quick and dirty Txn workalike.
  crimes.txn = config.txn = txn
  crimes.pull = config.pull = pull_replicate

  return {crimes:crimes, config:config, txn:txn, noop:noop, pullCrimes:pullCrimes}

  function pull_replicate(sourceUrl, opts) {
    opts = opts || {}

    console.log('Replicate from:', sourceUrl, opts)
    var rep = PouchDB.replicate(sourceUrl, this, opts)

    rep.on('error', function(er) {
      console.log('Pull error', sourceUrl, er)
    })
    rep.on('active', function() {
      console.log('Pull is active', sourceUrl)
    })
    rep.on('change', function(info) {
      console.log('Change in pull', sourceUrl, info)
    })
    rep.on('complete', function(info) {
      console.log('Pull complete', sourceUrl, info)
    })

    return rep
  }

  function pullCrimes() {
    console.log('Find doc IDs to replicate')
    var viewName = 'view/bostonlast7days'
    return
      crimes_origin.query(viewName, {reduce:false})
      .then(function(res) {
        console.log('Found %s documents to replicate from view: %s', res.rows.length, viewName)
        var ids = res.rows.map(function(row) { return row.id })
        var opts = {doc_ids:ids, filter:doc_filter}

        console.log('Begin pull from %s', crimes_origin, opts)
        puller = crimes.pull(crimes_origin, opts)
        puller.on('complete', function(info) {
          console.log('Replication complete, result:', info)
          puller = null
          return info
        }).catch(function(er) {
          console.log('Error pulling crimes DB', er)
          puller = null
        })

        return puller
      })

    function doc_filter(doc) {
      i += 1
      if (i % 10 == 0)
        puller.emit('filter-seen', i)

      return filter_city(doc)
    }

    function filter_city(doc) {
      var source = doc.properties && doc.properties.source
      var coords = doc.geometry && doc.geometry.coordinates

      if (! source)
        return false

      if (! coords) {
        console.log('%s doc with no coordinates: %s', source, doc._id)
        return false
      }

      console.log('Import', doc)
      return true
    }
  }

  // A quick and dirty TXN clone.
  function txn(opts, operation) {
    var db = this
    var deferred = $q.defer()

    go(0)
    return deferred.promise

    function go(i) {
      i += 1
      if (i > 5)
        return deferred.reject(new Error('Failed to update '+opts.id+' after '+i+' iterations'))

      if (typeof opts == 'string')
        opts = {id:opts}

      db.get(opts.id, function(er, doc) {
        if (er && er.status == 404 && opts.create)
          doc = {_id:opts.id}
        else if (er)
          return deferred.reject(er)

        var before = JSON.stringify(doc)
        var op_handled = false

        try { operation(doc, op_done) }
        catch (er) { return deferred.reject(er) }

        if (! op_handled)
          op_done() // The operation function did not call the callback

        function op_done(er) {
          op_handled = true

          if (er)
            return deferred.reject(er)

          var after = JSON.stringify(doc)
          if (before == after) {
            console.log('Skip no-op change:', doc._id)
            return deferred.resolve(doc)
          }

          doc.updated_at = new Date
          doc.created_at = doc.created_at || doc.updated_at

          db.put(doc, function(er, res) {
            if (er)
              return deferred.reject(er)

            doc._rev = res.rev
            deferred.resolve(doc)
          })
        }
      })
    } // go
  }
});
